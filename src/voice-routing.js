export const validProviderId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export const validPhone = value => typeof value === 'string' && /^\+[1-9][0-9]{6,14}$/.test(value);
