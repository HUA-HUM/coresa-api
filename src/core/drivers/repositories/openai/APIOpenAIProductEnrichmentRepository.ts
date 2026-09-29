import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { EnrichedProductContent } from '../../../adapters/repositories/IProductEnrichmentRepository';
import { CoresaProduct } from '../../../entities/CoresaProduct';
import { MeliCategoryAttribute } from '../../../entities/MeliCategory';
import { DraftAttribute } from '../../../entities/PublicationDraft';
import {
  DEFAULT_VARIANT,
  PublicationVariant,
} from '../../../entities/PublicationVariant';
import {
  asText,
  attributesForPrompt,
  describeAttributesForPrompt,
  MELI_TITLE_MAX_LENGTH,
  productFactsForPrompt,
  sanitizeAttributes,
  truncateTitle,
} from '../../../utils/enrichment';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4.1-mini';

const SYSTEM_PROMPT = [
  'Sos un especialista en publicaciones de MercadoLibre Argentina.',
  'Escribís en español rioplatense, sin exagerar ni inventar datos.',
  'Usás únicamente la información del producto que te pasan.',
  'Si un dato no está, lo omitís: nunca lo inventás.',
  'Respondés siempre con un JSON válido, sin texto alrededor.',
].join(' ');

export class APIOpenAIProductEnrichmentRepository {
  constructor(private readonly axios: AxiosInstance) {}

  private get apiKey(): string {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        '[openai] OPENAI_API_KEY no está definida. Revisá el archivo .env',
      );
    }
    return key;
  }

  get model(): string {
    return String(process.env.OPENAI_MODEL ?? DEFAULT_MODEL).trim();
  }

  private get timeout(): number {
    return Number(process.env.OPENAI_TIMEOUT_MS ?? 60000);
  }

  /**
   * Reglas extra cuando la publicación vende más de una unidad. Publicar un
   * pack con el título de la unidad suelta es una infracción en ML, así que
   * la cantidad tiene que estar en el título y en la descripción.
   */
  private packRules(variant: PublicationVariant): string[] {
    if (variant.unitsPerListing <= 1) return [];
    const units = variant.unitsPerListing;
    return [
      `- ESTA PUBLICACIÓN VENDE UN PACK DE ${units} UNIDADES. El comprador recibe ${units} unidades por compra.`,
      `- El título tiene que decirlo, con el formato "Pack X ${units}" al final. Entrá en el límite de caracteres contando ese texto: si no entra, acortá la descripción del producto, nunca el "Pack X ${units}".`,
      `- La descripción tiene que aclarar en el primer párrafo que son ${units} unidades.`,
      '- Las características técnicas siguen siendo las de UNA unidad: no multipliques medidas, potencias ni pesos.',
    ];
  }

  private buildUserPrompt(
    product: CoresaProduct,
    attributes: MeliCategoryAttribute[],
    variant: PublicationVariant,
  ): string {
    return [
      'Armá el contenido de una publicación de MercadoLibre para este producto mayorista.',
      '',
      'Producto (datos del proveedor):',
      JSON.stringify(productFactsForPrompt(product), null, 2),
      '',
      'Atributos de la categoría elegida:',
      JSON.stringify(describeAttributesForPrompt(attributes), null, 2),
      '',
      'Reglas:',
      `- "title": máximo ${MELI_TITLE_MAX_LENGTH} caracteres, con el formato producto + marca + modelo o característica principal. Sin mayúsculas sostenidas, sin signos de exclamación, sin precios ni promociones.`,
      '- "description": texto plano, sin HTML, de 3 a 6 párrafos cortos, con las características técnicas que aparezcan en los datos del producto.',
      '- "model": el modelo o código del fabricante si aparece en los datos; si no, string vacío.',
      '- "attributes": completá los obligatorios que puedas deducir de los datos. Cuando el atributo tenga "valores_permitidos", el value_name debe ser exactamente uno de esos valores. Si no podés deducir un atributo con los datos disponibles, no lo incluyas.',
      ...this.packRules(variant),
      '',
      'Respondé con este JSON:',
      '{"title": "...", "description": "...", "model": "...", "attributes": [{"id": "BRAND", "value_name": "..."}]}',
    ].join('\n');
  }

  private prepareRequest(prompt: string): AxiosRequestConfig {
    return {
      method: 'POST',
      url: OPENAI_URL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      data: {
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      },
    };
  }

  private parseContent(payload: unknown): {
    title?: unknown;
    description?: unknown;
    model?: unknown;
    attributes?: unknown;
  } {
    const choices = (
      payload as { choices?: { message?: { content?: string } }[] }
    )?.choices;
    const content = choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('[openai] respuesta sin content');
    }

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error(
        `[openai] content no es JSON válido: ${content.slice(0, 200)}`,
      );
    }
  }

  /**
   * Prompt distinto al de la primera pasada: acá NO se omite. Se elige el
   * valor más probable, porque un obligatorio vacío hace que ML rechace la
   * publicación entera. El que llama marca estos atributos como deducidos.
   */
  private buildCompletionPrompt(
    product: CoresaProduct,
    missing: MeliCategoryAttribute[],
    title: string,
  ): string {
    return [
      `MercadoLibre rechaza esta publicación porque faltan atributos obligatorios.`,
      '',
      `Título de la publicación: ${title}`,
      '',
      'Producto (datos del proveedor):',
      JSON.stringify(productFactsForPrompt(product), null, 2),
      '',
      'Atributos que faltan:',
      JSON.stringify(describeAttributesForPrompt(missing), null, 2),
      '',
      'Reglas:',
      '- Completá TODOS los atributos de la lista. No omitas ninguno.',
      '- Si el atributo tiene "valores_permitidos", el value_name tiene que ser exactamente uno de esos.',
      '- Usá lo que sepas del tipo de producto y de la marca para elegir el valor más probable, aunque no esté escrito en los datos del proveedor.',
      '- Ante la duda entre varios valores permitidos, elegí el más común para ese tipo de producto.',
      '',
      'Respondé con este JSON:',
      '{"attributes": [{"id": "MATERIAL", "value_name": "..."}]}',
    ].join('\n');
  }

  async completeMissingAttributes(
    product: CoresaProduct,
    missing: MeliCategoryAttribute[],
    title: string,
  ): Promise<DraftAttribute[]> {
    if (missing.length === 0) return [];

    const config = this.prepareRequest(
      this.buildCompletionPrompt(product, missing, title),
    );
    const response = await this.axios.request(config);
    const parsed = this.parseContent(response.data);
    const proposed = Array.isArray(parsed.attributes)
      ? (parsed.attributes as DraftAttribute[])
      : [];

    return sanitizeAttributes(proposed, missing);
  }

  async buildContent(
    product: CoresaProduct,
    categoryAttributes: MeliCategoryAttribute[],
    variant: PublicationVariant = DEFAULT_VARIANT,
  ): Promise<EnrichedProductContent> {
    const promptAttributes = attributesForPrompt(categoryAttributes);
    const config = this.prepareRequest(
      this.buildUserPrompt(product, promptAttributes, variant),
    );
    const response = await this.axios.request(config);
    const parsed = this.parseContent(response.data);

    const title = truncateTitle(
      asText(parsed.title) || asText(product.Descripcion),
    );
    const description = asText(parsed.description);
    const proposed = Array.isArray(parsed.attributes)
      ? (parsed.attributes as DraftAttribute[])
      : [];

    return {
      title,
      description,
      model: asText(parsed.model),
      attributes: sanitizeAttributes(proposed, categoryAttributes),
    };
  }
}
