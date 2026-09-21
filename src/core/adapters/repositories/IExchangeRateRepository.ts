export interface IExchangeRateRepository {
  getUsdBnaSell(): Promise<number>;
}

export const IExchangeRateRepositoryToken = Symbol('IExchangeRateRepository');
