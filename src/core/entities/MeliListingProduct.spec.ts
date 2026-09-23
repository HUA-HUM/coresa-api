import { isActiveMeliStatus, mapMeliBySkuLookup } from './MeliListingProduct';

describe('MeliListingProduct', () => {
  it('mapea meli_item_id, meliItemId, MLA e id', () => {
    expect(
      mapMeliBySkuLookup({ sku: 'A', status: 'active', MLA: 'MLA1' }),
    ).toEqual({
      sku: 'A',
      status: 'active',
      meli_item_id: 'MLA1',
    });
    expect(
      mapMeliBySkuLookup({
        data: { SKU: 'B', Status: 'paused', meliItemId: 'MLA2' },
      }),
    ).toEqual({ sku: 'B', status: 'paused', meli_item_id: 'MLA2' });
  });

  it('isActiveMeliStatus es case-insensitive', () => {
    expect(isActiveMeliStatus('active')).toBe(true);
    expect(isActiveMeliStatus('ACTIVE')).toBe(true);
    expect(isActiveMeliStatus('paused')).toBe(false);
  });
});
