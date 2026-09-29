import { CoresaProduct } from '../entities/CoresaProduct';
import {
  buildPublicationDraft,
  getGtin,
  isValidGtin,
  valueAddedTax,
} from './publicationDraft';

const product: CoresaProduct = {
  SKU: 'AEB 35 SC/1',
  Descripcion: 'SERIE A, Ángulo de fijación lateral AEB 35 SC/1',
  Marca: 'Weidmuller',
  CodBarra_Unitario: '4050118376722',
  Disponible: 1050,
  CantIntermedia: 0,
  Impuestos: 'IVA_21',
  Precio_Lista_1: 1.78,
  URL_Imagen: 'https://s3.coresagroup.com/WEIDMULLER/IMG/1991920000.jpg',
};

const content = {
  title: 'Ángulo De Fijación Lateral Weidmuller Aeb 35 Sc/1',
  description: 'Texto plano.',
  model: '1991920000',
  attributes: [{ id: 'COLOR', value_id: '52055' }],
};

function build(allowed: string[] = ['BRAND', 'MODEL', 'GTIN', 'COLOR']) {
  return buildPublicationDraft({
    product,
    categoryId: 'MLA1591',
    content,
    price: 1777,
    availableQuantity: 1050,
    allowedAttributeIds: new Set(allowed),
  });
}

describe('buildPublicationDraft', () => {
  it('toma el precio y el stock ya calculados de coresa_products', () => {
    const draft = build();

    expect(draft.price).toBe(1777);
    expect(draft.available_quantity).toBe(1050);
  });

  it('completa marca, modelo y GTIN desde los datos de Coresa', () => {
    const draft = build();

    expect(draft.attributes).toEqual([
      { id: 'COLOR', value_id: '52055' },
      { id: 'BRAND', value_name: 'Weidmuller' },
      { id: 'MODEL', value_name: '1991920000' },
      { id: 'GTIN', value_name: '4050118376722' },
    ]);
  });

  it('no agrega atributos que la categoría no admite', () => {
    const draft = build(['COLOR']);

    expect(draft.attributes).toEqual([{ id: 'COLOR', value_id: '52055' }]);
  });

  it('arma el resto del borrador con los valores por defecto', () => {
    const draft = build();

    expect(draft.sku).toBe('AEB 35 SC/1');
    expect(draft.category_id).toBe('MLA1591');
    expect(draft.condition).toBe('new');
    expect(draft.pictures).toEqual([product.URL_Imagen]);
    expect(draft.shipping).toEqual({ mode: 'me2', free_shipping: false });
    expect(draft.sale_terms?.map((term) => term.id)).toEqual([
      'WARRANTY_TYPE',
      'WARRANTY_TIME',
    ]);
  });

  it('usa el precio y el stock que le pasan, sin recalcular', () => {
    // Vienen de coresa_products; el producto crudo trae otros valores.
    const draft = buildPublicationDraft({
      product: { ...product, Precio_Lista_1: 999, Disponible: 7 },
      categoryId: 'MLA1591',
      content,
      price: 45000,
      availableQuantity: 12,
      allowedAttributeIds: new Set(['BRAND']),
    });

    expect(draft.price).toBe(45000);
    expect(draft.available_quantity).toBe(12);
  });

  it('publica solo como clásica', () => {
    expect(build().listing_types).toEqual(['gold_special']);
  });

  it('mantiene el resto del borrador al cambiar precio y stock', () => {
    const draft = buildPublicationDraft({
      product: { ...product, Disponible: 100, CantIntermedia: 6 },
      categoryId: 'MLA1591',
      content,
      price: 1777,
      availableQuantity: 1050,
      allowedAttributeIds: new Set(['BRAND']),
    });

    expect(draft.available_quantity).toBe(1050);
    expect(draft.price).toBe(1777);
    expect(draft.sku).toBe('AEB 35 SC/1');
    expect(draft.category_id).toBe('MLA1591');
  });

  it('toma el código de barras unitario como GTIN cuando es válido', () => {
    expect(getGtin(product)).toBe('4050118376722');
    expect(getGtin({ ...product, CodBarra_Unitario: undefined })).toBe('');
  });

  it('cae al código master cuando el unitario no cierra', () => {
    // Caso real de Coresa: al unitario le sobra un cero.
    expect(
      getGtin({
        ...product,
        CodBarra_Unitario: '40501183767220',
        CodBarra_Master: '4050118376722',
      }),
    ).toBe('4050118376722');
  });

  it('no manda GTIN si ninguno de los dos códigos es válido', () => {
    expect(
      getGtin({
        ...product,
        CodBarra_Unitario: '40501183767220',
        CodBarra_Master: '123',
      }),
    ).toBe('');
  });

  it('valida el dígito verificador y el largo', () => {
    expect(isValidGtin('4050118376722')).toBe(true);
    expect(isValidGtin('6942431492754')).toBe(true);
    expect(isValidGtin('40501183767220')).toBe(false);
    expect(isValidGtin('4050118376723')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('405011837672A')).toBe(false);
    expect(isValidGtin('')).toBe(false);
  });
});

describe('atributos de paquete e impuestos', () => {
  it('agrega los cuatro datos del paquete que pide ML', () => {
    const draft = buildPublicationDraft({
      product: {
        ...product,
        Alto_cm: 1.8,
        Ancho_cm: 3.8,
        Largo_cm: 7.3,
        Peso_kg: 0.01,
      },
      categoryId: 'MLA1591',
      content,
      price: 1777,
      availableQuantity: 1050,
      allowedAttributeIds: new Set(['BRAND']),
    });
    const ids = draft.attributes.map((attribute) => attribute.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'SELLER_PACKAGE_HEIGHT',
        'SELLER_PACKAGE_WIDTH',
        'SELLER_PACKAGE_LENGTH',
        'SELLER_PACKAGE_WEIGHT',
      ]),
    );
  });

  it('redondea las dimensiones para arriba y pasa el peso a gramos', () => {
    const draft = buildPublicationDraft({
      product: {
        ...product,
        Alto_cm: 1.8,
        Ancho_cm: 3.8,
        Largo_cm: 7.3,
        Peso_kg: 0.01,
      },
      categoryId: 'MLA1591',
      content,
      price: 1777,
      availableQuantity: 1050,
      allowedAttributeIds: new Set<string>(),
    });
    const paquete = Object.fromEntries(
      draft.attributes.map((attribute) => [attribute.id, attribute.value_name]),
    );

    expect(paquete.SELLER_PACKAGE_HEIGHT).toBe('2 cm');
    expect(paquete.SELLER_PACKAGE_WIDTH).toBe('4 cm');
    expect(paquete.SELLER_PACKAGE_LENGTH).toBe('8 cm');
    expect(paquete.SELLER_PACKAGE_WEIGHT).toBe('10 g');
  });

  it('no manda ningún dato de paquete si falta alguno', () => {
    const draft = buildPublicationDraft({
      product: { ...product, Peso_kg: 0 },
      categoryId: 'MLA1591',
      content,
      price: 1777,
      availableQuantity: 1050,
      allowedAttributeIds: new Set<string>(),
    });

    expect(
      draft.attributes.filter((attribute) =>
        attribute.id.startsWith('SELLER_PACKAGE'),
      ),
    ).toEqual([]);
  });

  it('traduce el IVA de Coresa al formato de ML', () => {
    expect(valueAddedTax({ SKU: 'X', Impuestos: 'IVA_21' })).toBe('21 %');
    expect(valueAddedTax({ SKU: 'X', Impuestos: 'IVA_10.5' })).toBe('10.5 %');
    expect(valueAddedTax({ SKU: 'X', Impuestos: '' })).toBe('');
  });

  it('agrega IVA y derecho de importación cuando la categoría los admite', () => {
    const draft = buildPublicationDraft({
      product: { ...product, Impuestos: 'IVA_21' },
      categoryId: 'MLA1591',
      content,
      price: 1777,
      availableQuantity: 1050,
      allowedAttributeIds: new Set(['VALUE_ADDED_TAX', 'IMPORT_DUTY']),
    });
    const porId = Object.fromEntries(
      draft.attributes.map((attribute) => [attribute.id, attribute.value_name]),
    );

    expect(porId.VALUE_ADDED_TAX).toBe('21 %');
    expect(porId.IMPORT_DUTY).toBe('0 %');
  });
  it('publica solo el tipo de la variante y lo deja anotado en el borrador', () => {
    const draft = buildPublicationDraft({
      product,
      categoryId: 'MLA1591',
      content,
      price: 1777,
      availableQuantity: 1050,
      allowedAttributeIds: new Set(['BRAND']),
      variant: {
        listingType: 'gold_pro',
        unitsPerListing: 6,
        modalidad: 'x12',
        priceFactor: 1.15,
      },
    });

    expect(draft.listing_types).toEqual(['gold_pro']);
    // La variante viaja en el borrador para poder registrarla cuando ML
    // devuelva el MLA; se saca del payload antes de mandarlo a meli-api.
    expect(draft.variant?.unitsPerListing).toBe(6);
  });

  it('no manda GTIN en un pack: el código de la unidad no lo identifica', () => {
    const draft = buildPublicationDraft({
      product,
      categoryId: 'MLA1591',
      content,
      price: 1777,
      availableQuantity: 175,
      allowedAttributeIds: new Set(['BRAND', 'MODEL', 'GTIN', 'COLOR']),
      variant: {
        listingType: 'gold_special',
        unitsPerListing: 6,
        modalidad: 'contado',
        priceFactor: 1,
      },
    });

    expect(draft.attributes.map((a) => a.id)).not.toContain('GTIN');
  });
});
