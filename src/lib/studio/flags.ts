/**
 * Settings v2 (STUDIO_SETTINGS_V2=1): the agent settings hub, Connectors & plugins, manager counts, change
 * history and quiet Telegram records. Read per request so the operator can turn it off without a restart;
 * default off. Rights coverage of connections does not depend on it.
 */
export const settingsV2 = (): boolean => process.env.STUDIO_SETTINGS_V2 === '1';
