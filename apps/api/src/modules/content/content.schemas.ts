import {
  ContentModuleKeySchema,
  PublicContentPayloadSchemas,
  type ContentModuleKey,
} from '@panshi/contracts'

export { ContentModuleKeySchema }

export const parsePublishedContent = (key: ContentModuleKey, payload: unknown) => (
  PublicContentPayloadSchemas[key].parse(payload)
)
