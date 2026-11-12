import { mapDiscontinuedSweep } from './CoresaProduct';

describe('mapDiscontinuedSweep', () => {
  it('lee la respuesta del barrido', () => {
    expect(mapDiscontinuedSweep({ updated: 3, skus: ['A', 'B', 'C'] })).toEqual(
      {
        updated: 3,
        refused: false,
        wouldUpdate: null,
        skus: ['A', 'B', 'C'],
      },
    );
  });

  it('la lee igual envuelta en data', () => {
    expect(mapDiscontinuedSweep({ data: { updated: 1, skus: ['A'] } })).toEqual(
      { updated: 1, refused: false, wouldUpdate: null, skus: ['A'] },
    );
  });

  it('acepta camelCase y snake_case para el freno', () => {
    expect(
      mapDiscontinuedSweep({ updated: 0, refused: true, would_update: 743 }),
    ).toMatchObject({ refused: true, wouldUpdate: 743 });
    expect(
      mapDiscontinuedSweep({ updated: 0, skipped: true, wouldUpdate: 743 }),
    ).toMatchObject({ refused: true, wouldUpdate: 743 });
  });

  // No sabemos con qué forma exacta va a contestar internal-api, así que no
  // hay que dar por hecho que barrió cuando en realidad se frenó.
  it('informar cuántas habría tocado sin tocar ninguna también es un freno', () => {
    expect(
      mapDiscontinuedSweep({ updated: 0, would_update: 743 }),
    ).toMatchObject({ refused: true, wouldUpdate: 743 });
  });

  it('cero bajas de verdad no es un freno', () => {
    expect(mapDiscontinuedSweep({ updated: 0 })).toEqual({
      updated: 0,
      refused: false,
      wouldUpdate: null,
      skus: [],
    });
  });

  it('una respuesta vacía o rara no explota', () => {
    for (const payload of [null, undefined, 'texto', [], {}]) {
      expect(mapDiscontinuedSweep(payload)).toEqual({
        updated: 0,
        refused: false,
        wouldUpdate: null,
        skus: [],
      });
    }
  });
});
