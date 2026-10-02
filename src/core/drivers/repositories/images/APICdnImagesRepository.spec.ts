import { APICdnImagesRepository } from './APICdnImagesRepository';

const CDN = 'https://cmd-images-market.loquieroaca.com';
const COresa = 'https://s3.coresagroup.com/JADEVER/300/JDMK1K61.jpg';
const PROCESADA =
  'https://marketplace-product-images.nyc3.cdn.digitaloceanspaces.com/mercadolibre/JDMK1K61/JDMK1K61-mercadolibre-001.jpg';

describe('APICdnImagesRepository', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, CMD_IMAGES_MARKET_API_BASE_URL: CDN };
  });
  afterEach(() => {
    process.env = env;
  });

  function build(request: jest.Mock) {
    return new APICdnImagesRepository({ request } as never);
  }

  it('pide el canal mercadolibre y devuelve la foto del CDN', async () => {
    const request = jest.fn().mockResolvedValue({
      data: { images: [{ publicUrl: PROCESADA }] },
    });

    const fotos = await build(request).prepareForMercadoLibre('JDMK1K61', [
      COresa,
    ]);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: `${CDN}/images/process`,
        data: {
          sku: 'JDMK1K61',
          channel: 'mercadolibre',
          imageUrls: [COresa],
        },
      }),
    );
    expect(fotos).toEqual([PROCESADA]);
  });

  it('si el CDN se cae, publica con la foto del proveedor', async () => {
    // Una foto chica puede quedar en infracción, pero no publicar es peor.
    const request = jest.fn().mockRejectedValue(new Error('CDN caído'));

    expect(
      await build(request).prepareForMercadoLibre('JDMK1K61', [COresa]),
    ).toEqual([COresa]);
  });

  it('si el CDN contesta sin fotos, usa las del proveedor', async () => {
    const request = jest.fn().mockResolvedValue({ data: { images: [] } });

    expect(
      await build(request).prepareForMercadoLibre('JDMK1K61', [COresa]),
    ).toEqual([COresa]);
  });

  it('sin el CDN configurado no llama a nadie', async () => {
    delete process.env.CMD_IMAGES_MARKET_API_BASE_URL;
    const request = jest.fn();

    expect(
      await build(request).prepareForMercadoLibre('JDMK1K61', [COresa]),
    ).toEqual([COresa]);
    expect(request).not.toHaveBeenCalled();
  });

  it('un producto sin foto no genera una llamada', async () => {
    const request = jest.fn();

    expect(await build(request).prepareForMercadoLibre('X', [])).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
