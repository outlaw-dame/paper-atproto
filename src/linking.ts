/**
 * Entity Linking Utility
 * 1. Named Entity Recognition (NER) using Transformers.js
 * 2. Entity Linking to Wikidata
 * 
 * Note: Transformers.js import is deferred to allow ONNX Runtime configuration
 */

export interface LinkedEntity {
  text: string;
  type: string;
  score: number;
  wikidataId?: string;
  description?: string;
}

let nerPipeline: any = null;
let transformersModule: any = null;

async function getTransformers() {
  if (!transformersModule) {
    transformersModule = await import('@xenova/transformers');
    // ONNX Runtime should already be pre-configured from bootstrap.ts
    // This is a fallback configuration in case it's needed
    const env = transformersModule.env;
    if (!env.backends?.onnx?.wasm?.numThreads) {
      env.localModelPath ??= '/models/';
      env.allowLocalModels ??= true;
      env.backends ??= {};
      env.backends.onnx ??= {};
      env.backends.onnx.wasm ??= {};
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
    }
  }
  return transformersModule;
}

export const initLinking = async () => {
  if (!nerPipeline) {
    const transformers = await getTransformers();
    // Using a lightweight NER model
    nerPipeline = await transformers.pipeline('token-classification', 'Xenova/distilbert-base-uncased-finetuned-conll03-english');
  }
};

/**
 * Extract entities from text using NER
 */
export const extractEntities = async (text: string): Promise<LinkedEntity[]> => {
  if (!nerPipeline) await initLinking();
  
  const results = await nerPipeline(text);
  
  // Group tokens into entities (e.g., "San" + "Francisco" -> "San Francisco")
  const entities: LinkedEntity[] = [];
  let currentEntity: any = null;

  for (const result of results) {
    const label = result.entity;
    const word = result.word;
    const score = result.score;

    if (label.startsWith('B-')) {
      if (currentEntity) entities.push(currentEntity);
      currentEntity = {
        text: word.startsWith('##') ? word.slice(2) : word,
        type: label.substring(2),
        score: score,
      };
    } else if (label.startsWith('I-') && currentEntity) {
      currentEntity.text += word.startsWith('##') ? word.slice(2) : ' ' + word;
      currentEntity.score = (currentEntity.score + score) / 2;
    } else {
      if (currentEntity) entities.push(currentEntity);
      currentEntity = null;
    }
  }
  if (currentEntity) entities.push(currentEntity);

  // Filter out low confidence and short entities
  return entities.filter(e => e.score > 0.8 && e.text.length > 1);
};

/**
 * Link an entity to Wikidata
 */
export const linkToWikidata = async (entityText: string): Promise<{ id: string; description: string } | null> => {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(entityText)}&language=en&format=json&origin=*`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.search && data.search.length > 0) {
      const result = data.search[0];
      return {
        id: result.id,
        description: result.description || 'No description available',
      };
    }
    return null;
  } catch (error) {
    console.error('Error linking to Wikidata:', error);
    return null;
  }
};

/**
 * Full Entity Linking Pipeline
 */
export const processTextEntities = async (text: string): Promise<LinkedEntity[]> => {
  const entities = await extractEntities(text);
  
  // Link each entity to Wikidata in parallel
  const linkedEntities = await Promise.all(
    entities.map(async (entity) => {
      const link = await linkToWikidata(entity.text);
      if (link) {
        return {
          ...entity,
          wikidataId: link.id,
          description: link.description,
        };
      }
      return entity;
    })
  );

  return linkedEntities;
};
