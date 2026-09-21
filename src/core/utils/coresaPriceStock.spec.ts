import {
  calculateCoresaPriceArs,
  calculateCoresaStock,
  DEFAULT_DISCOUNT_PERCENT,
  DEFAULT_MELI_SELLER_ID,
  getDiscountPercent,
  getMeliSellerId,
  mapListingToBulkProduct,
  toNumber,
} from './coresaPriceStock';

describe('coresaPriceStock', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('toNumber', () => {
    it('parsea formatos ES y vacíos como el script', () => {
      expect(toNumber('1.234,56')).toBe(1234.56);
      expect(toNumber('123,45')).toBe(123.45);
      expect(toNumber('1234.56')).toBe(1234.56);
      expect(toNumber('$ 100')).toBe(100);
      expect(toNumber('')).toBe(0);
      expect(toNumber(null)).toBe(0);
      expect(toNumber(12)).toBe(12);
    });
  });

  describe('calculateCoresaPriceArs', () => {
    it('aplica descuento 50%, IVA 21%, margen 65% y BNA', () => {
      // 100 * 0.5 * 1.21 * 1.65 * 1000 = 99825
      expect(calculateCoresaPriceArs(100, 1000, 50)).toBe(99825);
    });

    it('usa descuento default 50%', () => {
      expect(calculateCoresaPriceArs(100, 1000)).toBe(99825);
    });

    it('devuelve null si el USD lista o BNA no son > 0', () => {
      expect(calculateCoresaPriceArs(0, 1000)).toBeNull();
      expect(calculateCoresaPriceArs('no encontrado', 1000)).toBeNull();
      expect(calculateCoresaPriceArs(100, 0)).toBeNull();
    });
  });

  describe('calculateCoresaStock', () => {
    it('usa Disponible si CantIntermedia es 0 o vacía', () => {
      expect(calculateCoresaStock(12, 0)).toBe(12);
      expect(calculateCoresaStock(12, '')).toBe(12);
      expect(calculateCoresaStock('12', undefined)).toBe(12);
    });

    it('divide por CantIntermedia y redondea hacia abajo', () => {
      expect(calculateCoresaStock(100, 12)).toBe(8);
      expect(calculateCoresaStock('100', '12')).toBe(8);
    });
  });

  describe('mapListingToBulkProduct', () => {
    it('arma el body de /bulk y omite sin MLA o sin precio', () => {
      const listing = {
        meli_item_id: 'MLA123',
        product: {
          SKU: 'B0XXXX',
          Descripcion: 'Producto ejemplo',
          Precio_Lista_1: 100,
          Disponible: 100,
          CantIntermedia: 12,
        },
      };

      expect(
        mapListingToBulkProduct(listing, 1000, '6863691', 50),
      ).toEqual({
        meli_item_id: 'MLA123',
        seller_id: '6863691',
        sku: 'B0XXXX',
        title: 'Producto ejemplo',
        price: 99825,
        available_quantity: 8,
        status: 'active',
        raw_payload: {},
      });

      expect(
        mapListingToBulkProduct({ ...listing, meli_item_id: '' }, 1000, '6863691'),
      ).toBeNull();
      expect(
        mapListingToBulkProduct(
          { ...listing, product: { ...listing.product, Precio_Lista_1: 0 } },
          1000,
          '6863691',
        ),
      ).toBeNull();
    });
  });

  describe('env helpers', () => {
    it('lee descuento y seller_id con defaults', () => {
      process.env = { ...originalEnv };
      delete process.env.CORESA_PRICE_DISCOUNT_PERCENT;
      delete process.env.MELI_SELLER_ID;

      expect(getDiscountPercent()).toBe(DEFAULT_DISCOUNT_PERCENT);
      expect(getMeliSellerId()).toBe(DEFAULT_MELI_SELLER_ID);

      process.env.CORESA_PRICE_DISCOUNT_PERCENT = '40';
      process.env.MELI_SELLER_ID = '999';
      expect(getDiscountPercent()).toBe(40);
      expect(getMeliSellerId()).toBe('999');
    });
  });
});
