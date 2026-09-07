export type CommandExecutorKind = 'POLICY_DETAIL' | 'FLEXLIFE_QUOTE' | 'FORESIGHT' | 'IGO_APPLICATION_DRAFT'

// One registry drives both dispatch and the capabilities reported to Keepr One.
const COMMAND_EXECUTORS: Readonly<Record<string, CommandExecutorKind>> = Object.freeze({
  READ_POLICY_DETAIL: 'POLICY_DETAIL',
  FLEXLIFE_QUOTE: 'FLEXLIFE_QUOTE',
  GENERATE_ILLUSTRATION: 'FORESIGHT',
  PREPARE_APPLICATION_DRAFT: 'IGO_APPLICATION_DRAFT',
})

export const EXECUTABLE_COMMAND_CAPABILITIES = Object.freeze(Object.keys(COMMAND_EXECUTORS))

export function commandExecutorFor(capability: string): CommandExecutorKind {
  if (!Object.hasOwn(COMMAND_EXECUTORS, capability)) throw new Error('CAPABILITY_NOT_IMPLEMENTED')
  return COMMAND_EXECUTORS[capability]!
}
