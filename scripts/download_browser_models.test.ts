import { describe, expect, it } from 'vitest';

type DownloadBrowserModelVariant = 'quantized' | 'q4f16' | 'q4';

interface DownloadBrowserModelDefinition {
  key: string;
  id: string;
  purpose: string;
  variant: DownloadBrowserModelVariant;
}

interface DownloadBrowserModelsArgs {
  profiles: string[];
  include: string[];
  list: boolean;
}

type DownloadBrowserModelsModule = {
  parseArgs: (argv: string[]) => DownloadBrowserModelsArgs;
  resolveModels: (options: DownloadBrowserModelsArgs) => DownloadBrowserModelDefinition[];
  selectModelFiles: (model: DownloadBrowserModelDefinition, siblings: string[]) => string[];
};

async function loadDownloadBrowserModels(): Promise<DownloadBrowserModelsModule> {
  // TypeScript cannot infer types from the sibling .mjs script in this workspace.
  // @ts-expect-error - runtime module is valid and covered by tests.
  return (await import('./download_browser_models.mjs')) as unknown as DownloadBrowserModelsModule;
}

describe('download_browser_models', () => {
  it('resolves the premium profile without duplicates', async () => {
    const { parseArgs, resolveModels } = await loadDownloadBrowserModels();
    const args = parseArgs(['--profile', 'balanced', '--include', 'qwen35_2b_mm,smollm3_3b']);
    const models = resolveModels(args);

    expect(models.map((model) => model.key)).toEqual([
      'embeddings',
      'image_captioning',
      'tone',
      'toxicity',
      'sentiment',
      'smollm3_3b',
      'qwen35_2b_mm',
    ]);
  });

  it('selects q4f16 assets for SmolLM3 browser generation', async () => {
    const { parseArgs, resolveModels, selectModelFiles } = await loadDownloadBrowserModels();
    const model = resolveModels(parseArgs(['--include', 'smollm3_3b']))[0]!;
    expect(model).toBeTruthy();
    const selected = selectModelFiles(model, [
      'config.json',
      'generation_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/model.onnx',
      'onnx/model.onnx_data',
      'onnx/model_q4.onnx',
      'onnx/model_q4.onnx_data',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx_data',
      'onnx/model_quantized.onnx',
      'onnx/model_quantized.onnx_data',
    ]);

    expect(selected).toEqual([
      'config.json',
      'generation_config.json',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx_data',
      'tokenizer.json',
      'tokenizer_config.json',
    ]);
  });

  it('selects multimodal q4f16 decoder, embed, and vision assets for Qwen3.5-2B', async () => {
    const { parseArgs, resolveModels, selectModelFiles } = await loadDownloadBrowserModels();
    const model = resolveModels(parseArgs(['--include', 'qwen35_2b_mm']))[0]!;
    expect(model).toBeTruthy();
    const selected = selectModelFiles(model, [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'processor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/decoder_model_merged_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx_data',
      'onnx/decoder_model_merged_quantized.onnx_data_1',
      'onnx/decoder_model_merged_q4f16.onnx',
      'onnx/decoder_model_merged_q4f16.onnx_data',
      'onnx/embed_tokens_quantized.onnx',
      'onnx/embed_tokens_quantized.onnx_data',
      'onnx/embed_tokens_q4f16.onnx',
      'onnx/embed_tokens_q4f16.onnx_data',
      'onnx/vision_encoder_quantized.onnx',
      'onnx/vision_encoder_quantized.onnx_data',
      'onnx/vision_encoder_q4f16.onnx',
      'onnx/vision_encoder_q4f16.onnx_data',
    ]);

    expect(selected).toEqual([
      'config.json',
      'generation_config.json',
      'onnx/decoder_model_merged_q4f16.onnx',
      'onnx/decoder_model_merged_q4f16.onnx_data',
      'onnx/embed_tokens_q4f16.onnx',
      'onnx/embed_tokens_q4f16.onnx_data',
      'onnx/vision_encoder_q4f16.onnx',
      'onnx/vision_encoder_q4f16.onnx_data',
      'preprocessor_config.json',
      'processor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
    ]);
  });
});
