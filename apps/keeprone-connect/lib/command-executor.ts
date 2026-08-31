export type CommandExecutorKind = 'POLICY_DETAIL' | 'FLEXLIFE_QUOTE' | 'FORESIGHT' | 'IGO_APPLICATION_DRAFT'

/**
 * Browser commands are an allow-list. A capability declared by the shared
 * protocol is not executable until this extension contains its dedicated
 * implementation; falling through to another executor could navigate or write
 * the wrong carrier surface.
 */
export function commandExecutorFor(capability: string): CommandExecutorKind {
  switch (capability) {
    case 'READ_POLICY_DETAIL':
      return 'POLICY_DETAIL'
    case 'FLEXLIFE_QUOTE':
      return 'FLEXLIFE_QUOTE'
    case 'GENERATE_ILLUSTRATION':
      return 'FORESIGHT'
    case 'PREPARE_APPLICATION_DRAFT':
      return 'IGO_APPLICATION_DRAFT'
    default:
      throw new Error('CAPABILITY_NOT_IMPLEMENTED')
  }
}
