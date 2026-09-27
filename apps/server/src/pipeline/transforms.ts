import type { Transform, TransformableField } from '@smart-rss/shared';
import { collapseWhitespace, htmlToText } from '../lib/html.js';
import { errorMessage, ok, pipelineErr, type Result } from '../lib/result.js';
import type { MappedItem } from './types.js';

/** Bounds regex input size (defence in depth on top of safe-regex validation). */
const MAX_TRANSFORM_INPUT = 100_000;

type StringOp = (value: string | undefined) => string | undefined;
export type CompiledTransform = (item: MappedItem) => MappedItem;

function compileOp(transform: Transform): StringOp {
  switch (transform.op) {
    case 'regexReplace': {
      const regex = new RegExp(transform.pattern, transform.flags);
      // Only the scanned prefix is bounded; the remainder is kept untouched (never truncate stored values).
      return (value) =>
        value === undefined
          ? value
          : value.slice(0, MAX_TRANSFORM_INPUT).replace(regex, transform.replacement) + value.slice(MAX_TRANSFORM_INPUT);
    }
    case 'stripHtml':
      return (value) => (value === undefined ? value : htmlToText(value));
    case 'trim':
      return (value) => (value === undefined ? value : collapseWhitespace(value));
    case 'truncate':
      return (value) =>
        value !== undefined && value.length > transform.length
          ? `${value.slice(0, transform.length).trimEnd()}…`
          : value;
    case 'defaultValue':
      return (value) => (value?.trim() ? value : transform.value);
  }
}

const onField =
  (field: TransformableField, op: StringOp): CompiledTransform =>
  (item) => {
    const next = op(item[field]);
    return next === item[field] ? item : { ...item, [field]: next };
  };

export function compileTransforms(transforms: Transform[]): Result<CompiledTransform[]> {
  try {
    return ok(transforms.map((transform) => onField(transform.field, compileOp(transform))));
  } catch (error) {
    return pipelineErr('transform', `Invalid transform: ${errorMessage(error)}`, error);
  }
}

export function applyTransforms(items: MappedItem[], transforms: CompiledTransform[]): MappedItem[] {
  return items.map((item) => transforms.reduce((current, transform) => transform(current), item));
}
