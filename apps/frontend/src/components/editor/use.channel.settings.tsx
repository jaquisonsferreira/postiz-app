'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

interface SchemaProperty {
  type?: string;
  enum?: string[];
  description?: string;
}

export interface ChannelSettingsSchema {
  identifier: string;
  maxLength: number;
  settings: { properties: Record<string, SchemaProperty> } | null;
}

export const useChannelSettingsSchema = (integrationId: string) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as ChannelSettingsSchema;
  }, []);
  return useSWR(`/integrations/${integrationId}/settings-schema`, load, {
    revalidateOnFocus: false,
  });
};

// The fields a channel can be configured with in the editor: choices and
// switches. A choice starts at its first option, so a provider that requires
// one (who can reply on X, the post type on Instagram) gets a valid default
export const editableSettings = (schema?: ChannelSettingsSchema) =>
  Object.entries(schema?.settings?.properties || {}).filter(
    ([, property]) => !!property.enum?.length || property.type === 'boolean'
  );

export const defaultSettings = (schema?: ChannelSettingsSchema): Record<string, unknown> =>
  Object.fromEntries(
    editableSettings(schema).map(([key, property]) => [key, property.enum ? property.enum[0] : false])
  );
