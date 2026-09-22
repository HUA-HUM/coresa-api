import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { EnrichedProductContent } from '../../../adapters/repositories/IProductEnrichmentRepository';
import { CoresaProduct } from '../../../entities/CoresaProduct';
import { MeliCategoryAttribute } from '../../../entities/MeliCategory';
import { DraftAttribute } from '../../../entities/PublicationDraft';
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

  private buildUserPrompt(
    product: CoresaProduct,
    attributes: MeliCategoryAttribute[],
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

  async buildContent(
    product: CoresaProduct,
    categoryAttributes: MeliCategoryAttribute[],
  ): Promise<EnrichedProductContent> {
    const promptAttributes = attributesForPrompt(categoryAttributes);
    const config = this.prepareRequest(
      this.buildUserPrompt(product, promptAttributes),
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
