import type { OpenStream } from "./provider.ts";
import { openStubStream } from "./stub.ts";

const providers: Record<string, OpenStream> = {
  stub: openStubStream,
};

export const providerNames = Object.keys(providers);

export function getProvider(name: string | undefined): OpenStream | undefined {
  return name !== undefined && Object.hasOwn(providers, name)
    ? providers[name]
    : undefined;
}
