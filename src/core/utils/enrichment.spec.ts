import { MeliCategoryAttribute } from '../entities/MeliCategory';
import {
  attributesForPrompt,
  missingRequiredAttributes,
  normalizeNumberUnit,
  productFactsForPrompt,
  sanitizeAttributes,
  stripExternalLinks,
  truncateTitle,
} from './enrichment';

function attribute(
  partial: Partial<MeliCategoryAttribute> & { id: string },
): MeliCategoryAttribute {
  return {
    name: partial.id,
    value_type: 'string',
    required: false,
    allowed_values: [],
    allowed_units: [],
    hint: null,
    ...partial,
  };
}

describe('enrichment', () => {
  describe('productFactsForPrompt', () => {
    it('deja afuera precio, stock y campos vacíos', () => {
      const facts = productFactsForPrompt({
        SKU: 'PC12NW',
        Descripcion: 'PANEL PLAFON 12W',
        Marca: 'Macroled',
        Color: '',
        Precio_Lista_1: 7.65,
        Disponible: 3840,
        Moneda: 'USD',
      });

      expect(facts).toEqual({
        SKU: 'PC12NW',
        Descripcion: 'PANEL PLAFON 12W',
        Marca: 'Macroled',
      });
    });
  });

  describe('truncateTitle', () => {
    it('corta en el último espacio sin pasar de 60 caracteres', () => {
      const title = truncateTitle(
        'Panel Plafon Cuadrado Macroled 12w Neutro 4500k Para Embutir En Techo',
      );

      expect(title.length).toBeLessThanOrEqual(60);
      expect(title.endsWith(' ')).toBe(false);
      expect(title.startsWith('Panel Plafon Cuadrado Macroled 12w')).toBe(true);
    });

    it('normaliza espacios y deja títulos cortos intactos', () => {
      expect(truncateTitle('  Panel   LED 12W ')).toBe('Panel LED 12W');
    });
  });

  describe('attributesForPrompt', () => {
    it('pone los obligatorios primero y recorta los opcionales', () => {
      const attributes = [
        attribute({ id: 'OPT1' }),
        attribute({ id: 'REQ1', required: true }),
        attribute({ id: 'OPT2' }),
      ];

      const result = attributesForPrompt(attributes, 1);

      expect(result.map((item) => item.id)).toEqual(['REQ1', 'OPT1']);
    });
  });

  describe('sanitizeAttributes', () => {
    const categoryAttributes = [
      attribute({ id: 'BRAND', required: true }),
      attribute({
        id: 'COLOR',
        allowed_values: [
          { id: '52055', name: 'Blanco' },
          { id: '52056', name: 'Negro' },
        ],
      }),
    ];

    it('descarta atributos que no son de la categoría', () => {
      const result = sanitizeAttributes(
        [
          { id: 'BRAND', value_name: 'Macroled' },
          { id: 'INVENTADO', value_name: 'Algo' },
        ],
        categoryAttributes,
      );

      expect(result).toEqual([{ id: 'BRAND', value_name: 'Macroled' }]);
    });

    it('convierte un valor permitido en value_id, sin importar mayúsculas', () => {
      const result = sanitizeAttributes(
        [{ id: 'COLOR', value_name: 'blanco' }],
        categoryAttributes,
      );

      expect(result).toEqual([
        { id: 'COLOR', value_id: '52055', value_name: 'Blanco' },
      ]);
    });

    it('descarta un valor que no está en la lista permitida', () => {
      const result = sanitizeAttributes(
        [{ id: 'COLOR', value_name: 'Fucsia' }],
        categoryAttributes,
      );

      expect(result).toEqual([]);
    });

    it('descarta valores vacíos y atributos repetidos', () => {
      const result = sanitizeAttributes(
        [
          { id: 'BRAND', value_name: '  ' },
          { id: 'COLOR', value_id: '52056' },
          { id: 'COLOR', value_id: '52055' },
        ],
        categoryAttributes,
      );

      expect(result).toEqual([
        { id: 'COLOR', value_id: '52056', value_name: 'Negro' },
      ]);
    });
  });

  describe('missingRequiredAttributes', () => {
    it('lista los obligatorios que quedaron sin valor', () => {
      const categoryAttributes = [
        attribute({ id: 'BRAND', required: true }),
        attribute({ id: 'MODEL', required: true }),
        attribute({ id: 'COLOR' }),
      ];

      const missing = missingRequiredAttributes(
        [{ id: 'BRAND', value_name: 'Macroled' }],
        categoryAttributes,
      );

      expect(missing).toEqual(['MODEL']);
    });
  });
});

describe('stripExternalLinks', () => {
  it('borra la oración con el link, no solo el link', () => {
    // Quitar la URL sola dejaría "se puede consultar la página oficial en ."
    const texto =
      'Atornillador brushless de 20V. Incluye punta y conector.\n\n' +
      'Para más información, se puede consultar la página oficial del proveedor en https://macroled.com.ar.';

    expect(stripExternalLinks(texto)).toBe(
      'Atornillador brushless de 20V. Incluye punta y conector.',
    );
  });

  it('también saca dominios sueltos, mails y teléfonos', () => {
    expect(stripExternalLinks('Bueno. Visitá macroled.com.ar hoy.')).toBe(
      'Bueno.',
    );
    expect(stripExternalLinks('Bueno. Escribinos a ventas@soled.com.')).toBe(
      'Bueno.',
    );
    expect(stripExternalLinks('Bueno. Llamanos al +54 11 4567-8900.')).toBe(
      'Bueno.',
    );
  });

  it('no toca una descripción limpia', () => {
    const texto =
      'Alicate de corte diagonal de 160 mm.\n\nMango bicolor ergonómico.';

    expect(stripExternalLinks(texto)).toBe(texto);
  });

  it('no se come un número de modelo con punto', () => {
    expect(stripExternalLinks('Modelo JDPL3606. Corta hasta 2.5 mm.')).toBe(
      'Modelo JDPL3606. Corta hasta 2.5 mm.',
    );
  });
});

describe('normalizeNumberUnit', () => {
  it('acepta la unidad permitida y normaliza el espaciado', () => {
    expect(normalizeNumberUnit('20W', ['W', 'kW'])).toBe('20 W');
    expect(normalizeNumberUnit('  160 mm ', ['mm', 'cm'])).toBe('160 mm');
    expect(normalizeNumberUnit('1,3 kg', ['kg', 'g'])).toBe('1.3 kg');
  });

  it('descarta una unidad que ML no admite para ese atributo', () => {
    // Mandarla haría que ML rechace la publicación entera; sin el atributo
    // opcional, se publica igual.
    expect(normalizeNumberUnit('20 HP', ['W', 'kW'])).toBeNull();
  });

  it('completa el número pelado solo si hay una sola unidad posible', () => {
    expect(normalizeNumberUnit('4200', ['rpm'])).toBe('4200 rpm');
    // 6,35 puede ser mm o cm: adivinar es un orden de magnitud de diferencia.
    expect(normalizeNumberUnit('6.35', ['mm', 'cm'])).toBeNull();
  });
});
