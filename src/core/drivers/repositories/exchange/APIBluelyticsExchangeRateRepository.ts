import { AxiosInstance, AxiosRequestConfig } from 'axios';

export class APIBluelyticsExchangeRateRepository {
  constructor(private readonly axios: AxiosInstance) {}

  private get apiUrl(): string {
    return 'https://api.bluelytics.com.ar/v2/latest';
  }

  private prepareRequest(
    query: Record<string, string | number> = {},
  ): AxiosRequestConfig {
    return {
      method: 'GET',
      url: this.apiUrl,
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      params: query,
    };
  }

  async getUsdBnaSell(): Promise<number> {
    const config = this.prepareRequest({ _: Date.now() });
    const response = await this.axios.request(config);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `[bluelytics] HTTP ${response.status}: ${JSON.stringify(response.data)}`,
      );
    }

    const sell = (response.data as { oficial?: { value_sell?: unknown } })
      ?.oficial?.value_sell;

    if (typeof sell !== 'number' || !(sell > 0)) {
      throw new Error(
        `[bluelytics] oficial.value_sell inválido: ${JSON.stringify(response.data)}`,
      );
    }

    return sell;
  }
}
