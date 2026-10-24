import { createDeepgram, DEEPGRAM_DEFAULT_MODEL } from "./deepgram.ts";
import { createMistral, MISTRAL_DEFAULT_MODEL } from "./mistral.ts";
import type { OpenStream } from "./provider.ts";
import { openStubStream } from "./stub.ts";

// Each provider is created from the environment. It throws when its
// configuration is incomplete.
const providers: Record<string, (env: NodeJS.ProcessEnv) => OpenStream> = {
  stub: () => openStubStream,
  mistral: (env) => {
    if (!env.MISTRAL_API_KEY) {
      throw new Error("MISTRAL_API_KEY is required when PROVIDER=mistral");
    }
    return createMistral({
      apiKey: env.MISTRAL_API_KEY,
      model: env.MISTRAL_MODEL || MISTRAL_DEFAULT_MODEL,
    });
  },
  deepgram: (env) => {
    if (!env.DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY is required when PROVIDER=deepgram");
    }
    return createDeepgram({
      apiKey: env.DEEPGRAM_API_KEY,
      model: env.DEEPGRAM_MODEL || DEEPGRAM_DEFAULT_MODEL,
      mipOptIn: env.DEEPGRAM_MIP_OPT_IN === "true",
    });
  },
};

export const providerNames = Object.keys(providers);

export function getProvider(
  name: string | undefined,
): ((env: NodeJS.ProcessEnv) => OpenStream) | undefined {
  return name !== undefined && Object.hasOwn(providers, name)
    ? providers[name]
    : undefined;
}
