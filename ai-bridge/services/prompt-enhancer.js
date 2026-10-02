/**
 * Prompt Enhancement Service.
 * Routes enhancement requests to the one-shot ask service (Qwen SDK engine).
 *
 * Supports context information:
 * - User selected code snippets
 * - Current open file information (path, content, language type)
 * - Cursor position and surrounding code
 * - Related file information
 */

import { pathToFileURL } from 'node:url';

import { askOneShot, isAskProvider } from './ask-service.js';
import { getRealHomeDir } from '../utils/path-utils.js';

// stdout protocol markers (line-oriented; keep payloads JSON-encoded for deltas)
//   [CONTENT_DELTA] <json-string>  — progressive token chunk
//   [ENHANCED]<text>               — final success (newlines as {{NEWLINE}})
//   [ENHANCED_ERROR]<msg>          — final failure

/** Mirrors chat AVAILABLE_PROVIDERS / webview AiFeatureProvider. */
const AI_FEATURE_PROVIDERS = ['qwen', 'dsh'];

const DEFAULT_PROMPT_ENHANCER_CONFIG = {
  provider: null,
  effectiveProvider: 'qwen',
  resolutionSource: 'auto',
  models: {
    qwen: 'auto',
    dsh: 'auto',
  },
  availability: {
    qwen: false,
    dsh: false,
  },
};

function isAiFeatureProvider(value) {
  return typeof value === 'string' && AI_FEATURE_PROVIDERS.includes(value);
}

// Context length limits (in characters) to avoid exceeding model token limits
const MAX_SELECTED_CODE_LENGTH = 2000;
const MAX_CURSOR_CONTEXT_LENGTH = 1000;
const MAX_CURRENT_FILE_LENGTH = 3000;
const MAX_RELATED_FILES_LENGTH = 2000;
const MAX_SINGLE_RELATED_FILE_LENGTH = 500;

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', reject);
  });
}

function truncateText(text, maxLength, fromEnd = false) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  if (fromEnd) {
    return '...\n' + text.slice(-maxLength);
  }
  return text.slice(0, maxLength) + '\n...';
}

function getLanguageFromPath(filePath) {
  if (!filePath) return 'text';

  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'c': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'swift': 'swift',
    'scala': 'scala',
    'vue': 'vue',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'sql': 'sql',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
  };

  return langMap[ext] || 'text';
}

export function buildFullPrompt(originalPrompt, context) {
  let fullPrompt = `Please optimize the following prompt:\n\n${originalPrompt}`;

  if (!context) {
    return fullPrompt;
  }

  const contextParts = [];

  if (context.selectedCode && context.selectedCode.trim()) {
    const truncatedCode = truncateText(context.selectedCode, MAX_SELECTED_CODE_LENGTH);
    const language = context.currentFile?.language || getLanguageFromPath(context.currentFile?.path) || 'text';
    contextParts.push(`[User Selected Code]\n\`\`\`${language}\n${truncatedCode}\n\`\`\``);
    console.log(`[PromptEnhancer] Added selected code context, length: ${context.selectedCode.length}`);
  }

  if (!context.selectedCode && context.cursorContext && context.cursorContext.trim()) {
    const truncatedContext = truncateText(context.cursorContext, MAX_CURSOR_CONTEXT_LENGTH);
    const language = context.currentFile?.language || getLanguageFromPath(context.currentFile?.path) || 'text';
    const lineInfo = context.cursorPosition ? ` (line ${context.cursorPosition.line})` : '';
    contextParts.push(`[Code Around Cursor${lineInfo}]\n\`\`\`${language}\n${truncatedContext}\n\`\`\``);
    console.log(`[PromptEnhancer] Added cursor context, length: ${context.cursorContext.length}`);
  }

  if (context.currentFile) {
    const { path, language, content } = context.currentFile;
    let fileInfo = '';

    if (path) {
      const lang = language || getLanguageFromPath(path);
      fileInfo = `[Current File] ${path}\n[Language Type] ${lang}`;

      if (!context.selectedCode && !context.cursorContext && content && content.trim()) {
        const truncatedContent = truncateText(content, MAX_CURRENT_FILE_LENGTH);
        fileInfo += `\n[File Content Preview]\n\`\`\`${lang}\n${truncatedContent}\n\`\`\``;
        console.log(`[PromptEnhancer] Added file content preview, length: ${content.length}`);
      }

      contextParts.push(fileInfo);
      console.log(`[PromptEnhancer] Added current file info: ${path}`);
    }
  }

  if (context.relatedFiles && Array.isArray(context.relatedFiles) && context.relatedFiles.length > 0) {
    let totalLength = 0;
    const relatedFilesInfo = [];

    for (const file of context.relatedFiles) {
      if (totalLength >= MAX_RELATED_FILES_LENGTH) {
        console.log('[PromptEnhancer] Related files total length reached limit, skipping remaining files');
        break;
      }

      if (file.path) {
        let fileEntry = `- ${file.path}`;
        if (file.content && file.content.trim()) {
          const remainingLength = MAX_RELATED_FILES_LENGTH - totalLength;
          const maxLength = Math.min(MAX_SINGLE_RELATED_FILE_LENGTH, remainingLength);
          const truncatedContent = truncateText(file.content, maxLength);
          const lang = getLanguageFromPath(file.path);
          fileEntry += `\n\`\`\`${lang}\n${truncatedContent}\n\`\`\``;
          totalLength += truncatedContent.length;
        }
        relatedFilesInfo.push(fileEntry);
      }
    }

    if (relatedFilesInfo.length > 0) {
      contextParts.push(`[Related Files]\n${relatedFilesInfo.join('\n')}`);
      console.log(`[PromptEnhancer] Added ${relatedFilesInfo.length} related file(s)`);
    }
  }

  if (context.projectType) {
    contextParts.push(`[Project Type] ${context.projectType}`);
    console.log(`[PromptEnhancer] Added project type: ${context.projectType}`);
  }

  if (contextParts.length > 0) {
    fullPrompt += '\n\n---\nThe following is relevant context information, please refer to it when optimizing the prompt:\n\n'
      + contextParts.join('\n\n');
  }

  return fullPrompt;
}

function normalizePromptEnhancerConfig(config) {
  if (!config || typeof config !== 'object') {
    return structuredClone(DEFAULT_PROMPT_ENHANCER_CONFIG);
  }

  const models = { ...DEFAULT_PROMPT_ENHANCER_CONFIG.models };
  const availability = { ...DEFAULT_PROMPT_ENHANCER_CONFIG.availability };
  for (const provider of AI_FEATURE_PROVIDERS) {
    if (typeof config.models?.[provider] === 'string' && config.models[provider].trim()) {
      models[provider] = config.models[provider].trim();
    }
    if (config.availability && provider in config.availability) {
      availability[provider] = Boolean(config.availability[provider]);
    }
  }

  return {
    provider: isAiFeatureProvider(config.provider) ? config.provider : null,
    effectiveProvider: isAiFeatureProvider(config.effectiveProvider) ? config.effectiveProvider : null,
    resolutionSource: typeof config.resolutionSource === 'string' ? config.resolutionSource : 'auto',
    models,
    availability,
  };
}

/**
 * In auto mode, prefer the model currently selected in the chat input when the
 * resolved enhancer provider matches the chat provider. Manual mode keeps the
 * remembered per-provider enhancer model.
 *
 * @param {object} options
 * @param {string} options.provider - resolved effective provider
 * @param {string} options.configuredModel - models[provider] from settings
 * @param {string} [options.resolutionSource]
 * @param {string} [options.chatProvider]
 * @param {string} [options.chatModel]
 * @returns {string}
 */
export function resolveAutoChatModel({
  provider,
  configuredModel,
  resolutionSource,
  chatProvider,
  chatModel,
} = {}) {
  const isAuto = resolutionSource === 'auto';
  if (!isAuto || !provider) {
    return configuredModel;
  }
  const chatProv = typeof chatProvider === 'string' ? chatProvider.trim().toLowerCase() : '';
  const chatMod = typeof chatModel === 'string' ? chatModel.trim() : '';
  if (!chatProv || !chatMod) {
    return configuredModel;
  }
  if (chatProv !== String(provider).trim().toLowerCase()) {
    return configuredModel;
  }
  return chatMod;
}

export function resolvePromptEnhancerRuntimeConfig({
  promptEnhancerConfig,
  legacyModel,
  chatProvider,
  chatModel,
} = {}) {
  if (!promptEnhancerConfig) {
    return {
      provider: 'qwen',
      model: legacyModel || DEFAULT_PROMPT_ENHANCER_CONFIG.models.qwen,
      resolutionSource: 'legacy',
    };
  }

  const config = normalizePromptEnhancerConfig(promptEnhancerConfig);

  // Prefer Java-resolved effectiveProvider.
  if (isAiFeatureProvider(config.effectiveProvider)) {
    const provider = config.effectiveProvider;
    const configuredModel = config.models[provider] || DEFAULT_PROMPT_ENHANCER_CONFIG.models[provider];
    return {
      provider,
      model: resolveAutoChatModel({
        provider,
        configuredModel,
        resolutionSource: config.resolutionSource,
        chatProvider,
        chatModel,
      }),
      resolutionSource: config.resolutionSource,
    };
  }

  if (config.provider && isAiFeatureProvider(config.provider)) {
    throw new Error(
      `${config.provider} prompt enhancer is unavailable because no active ${config.provider} provider is configured.`
    );
  }

  throw new Error('No available prompt enhancer provider is configured. Please configure a provider in Settings → Prompt Enhancer.');
}

export function extractAppendedDelta(previousText, nextText) {
  const previous = typeof previousText === 'string' ? previousText : '';
  const next = typeof nextText === 'string' ? nextText : '';
  if (!next.trim()) return '';
  if (!previous) return next;
  if (next === previous) return '';
  if (!next.startsWith(previous)) return next;
  return next.slice(previous.length);
}

/**
 * Cap output tokens based on input size so long requirements are not truncated
 * while short prompts stay cheap.
 */
export function computeMaxTokens(promptLength) {
  const len = typeof promptLength === 'number' && Number.isFinite(promptLength) && promptLength > 0
    ? promptLength
    : 0;
  return Math.min(8192, Math.max(2048, Math.ceil(len * 2)));
}

/**
 * Emit a progressive content delta marker for the Java process runner.
 * Uses stdout.write so markers stay line-atomic and unbuffered relative to logs.
 */
export function emitContentDelta(text) {
  if (typeof text !== 'string' || !text) return;
  process.stdout.write(`[CONTENT_DELTA] ${JSON.stringify(text)}\n`);
}

async function enhancePrompt(originalPrompt, systemPrompt, runtimeConfig, context) {
  const systemPromptText = (systemPrompt || '').trim();
  const parts = [];
  if (systemPromptText) {
    parts.push(systemPromptText);
  }
  parts.push(buildFullPrompt(originalPrompt, context));
  parts.push('Remember: output only the optimized prompt text with no explanation. Do not run tools.');
  const fullPrompt = parts.join('\n\n');

  const askProvider = isAskProvider(runtimeConfig.provider) ? runtimeConfig.provider : 'qwen';
  console.log(`[PromptEnhancer] ask provider=${askProvider}, model=${runtimeConfig.model || '(default)'}, promptLen=${fullPrompt.length}`);

  return askOneShot({
    provider: askProvider,
    prompt: fullPrompt,
    model: runtimeConfig.model,
    cwd: getRealHomeDir(),
    onDelta: emitContentDelta,
  });
}

export async function runPromptEnhancerRequest(data) {
  const {
    prompt,
    systemPrompt,
    legacyModel,
    context,
    promptEnhancerConfig,
    chatProvider,
    chatModel,
  } = data;

  if (!prompt) {
    return '';
  }

  const runtimeConfig = resolvePromptEnhancerRuntimeConfig({
    promptEnhancerConfig,
    legacyModel,
    chatProvider,
    chatModel,
  });
  console.log(`[PromptEnhancer] Resolved provider: ${runtimeConfig.provider}, model: ${runtimeConfig.model}, source: ${runtimeConfig.resolutionSource}`);

  return enhancePrompt(prompt, systemPrompt, runtimeConfig, context);
}

async function main() {
  try {
    const input = await readStdin();
    const data = JSON.parse(input);

    const { prompt, context } = data;

    if (!prompt) {
      process.stdout.write('[ENHANCED]\n');
      process.exit(0);
    }

    if (context) {
      console.log('[PromptEnhancer] Received context info:');
      if (context.selectedCode) {
        console.log(`  - Selected code: ${context.selectedCode.length} chars`);
      }
      if (context.currentFile) {
        console.log(`  - Current file: ${context.currentFile.path}`);
      }
      if (context.cursorPosition) {
        console.log(`  - Cursor position: line ${context.cursorPosition.line}`);
      }
      if (context.relatedFiles) {
        console.log(`  - Related files: ${context.relatedFiles.length}`);
      }
    } else {
      console.log('[PromptEnhancer] No context info received');
    }

    const enhancedPrompt = await runPromptEnhancerRequest(data);
    const encodedPrompt = enhancedPrompt.replace(/\n/g, '{{NEWLINE}}');
    process.stdout.write(`[ENHANCED]${encodedPrompt}\n`);
    process.exit(0);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error('[PromptEnhancer] Error:', message);
    process.stdout.write(`[ENHANCED_ERROR]${message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
