import { MeliCategoryAttribute } from '../entities/MeliCategory';
import {
  attributesForPrompt,
  missingRequiredAttributes,
  productFactsForPrompt,
  sanitizeAttributes,
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

      expect(result).toEqual([{ id: 'COLOR', value_id: '52055' }]);
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

      expect(result).toEqual([{ id: 'COLOR', value_id: '52056' }]);
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
