import { APIBluelyticsExchangeRateRepository } from './APIBluelyticsExchangeRateRepository';

describe('APIBluelyticsExchangeRateRepository', () => {
  it('devuelve oficial.value_sell', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { oficial: { value_sell: 1210.5 } },
    });
    const repo = new APIBluelyticsExchangeRateRepository({ request } as never);

    await expect(repo.getUsdBnaSell()).resolves.toBe(1210.5);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://api.bluelytics.com.ar/v2/latest',
        params: { _: expect.any(Number) },
      }),
    );
  });

  it('falla si value_sell no es un número > 0', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { oficial: { value_sell: 0 } },
    });
    const repo = new APIBluelyticsExchangeRateRepository({ request } as never);

    await expect(repo.getUsdBnaSell()).rejects.toThrow(
      /oficial\.value_sell inválido/,
    );
  });
});
