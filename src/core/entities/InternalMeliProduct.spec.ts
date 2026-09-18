import {
  isActiveMeliStatus,
  mapInternalMeliProduct,
} from './InternalMeliProduct';

describe('InternalMeliProduct', () => {
  it('mapea meli_item_id, meliItemId, MLA e id', () => {
    expect(mapInternalMeliProduct({ sku: 'A', status: 'active', MLA: 'MLA1' })).toEqual({
      sku: 'A',
      status: 'active',
      meli_item_id: 'MLA1',
    });
    expect(
      mapInternalMeliProduct({
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
