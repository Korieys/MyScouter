import { ScoutError, type ScoutCopy } from './scout-access';
export function validateCopy(value: unknown): ScoutCopy {
    if (!value || typeof value !== 'object') throw new ScoutError(502, 'Copy generation returned an incomplete draft. Try again.');
    const copy = value as Record<string, unknown>;
    const validText = (v:unknown, max:number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (!validText(copy.pitch,500) || !validText(copy.tagline,200) || !validText(copy.twitter,500) || !Array.isArray(copy.blurbs) || copy.blurbs.length < 1 || copy.blurbs.length > 5 || copy.blurbs.some(v => !validText(v,500))) {
        throw new ScoutError(502, 'Copy generation returned an incomplete draft. Try again.');
    }
    return {pitch:copy.pitch as string, tagline:copy.tagline as string, twitter:copy.twitter as string, blurbs:copy.blurbs as string[]};
}
