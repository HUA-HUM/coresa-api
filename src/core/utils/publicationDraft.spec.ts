import { CoresaProduct } from '../entities/CoresaProduct';
import { buildPublicationDraft, getGtin } from './publicationDraft';

const product: CoresaProduct = {
  SKU: 'AEB 35 SC/1',
  Descripcion: 'SERIE A, Ángulo de fijación lateral AEB 35 SC/1',
  Marca: 'Weidmuller',
  CodBarra_Unitario: '4050118376722',
  Disponible: 1050,
  CantIntermedia: 0,
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
    usdBna: 1000,
    discountPercent: 50,
    allowedAttributeIds: new Set(allowed),
  });
}

describe('buildPublicationDraft', () => {
  it('calcula precio y stock con la fórmula de Coresa', () => {
    const draft = build();

    // 1.78 * 0.5 * 1.21 * 1.65 * 1000
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

  it('falla si el producto no tiene precio de lista', () => {
    expect(() =>
      buildPublicationDraft({
        product: { ...product, Precio_Lista_1: 0 },
        categoryId: 'MLA1591',
        content,
        usdBna: 1000,
        discountPercent: 50,
        allowedAttributeIds: new Set(['BRAND']),
      }),
    ).toThrow(/sin precio de lista/);
  });

  it('divide el stock por el empaque intermedio cuando hay', () => {
    const draft = buildPublicationDraft({
      product: { ...product, Disponible: 100, CantIntermedia: 6 },
      categoryId: 'MLA1591',
      content,
      usdBna: 1000,
      discountPercent: 50,
      allowedAttributeIds: new Set(['BRAND']),
    });

    expect(draft.available_quantity).toBe(16);
  });

  it('toma el código de barras unitario como GTIN', () => {
    expect(getGtin(product)).toBe('4050118376722');
    expect(getGtin({ ...product, CodBarra_Unitario: undefined })).toBe('');
  });
});
