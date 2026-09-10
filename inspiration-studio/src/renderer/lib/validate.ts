import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/isx.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(schema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validates a document against the real, shipped .isx v1.0 schema — the same file the runtimes trust. */
export function validateIsx(doc: unknown): ValidationResult {
  const valid = validateFn(doc);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`);
  return { valid: false, errors };
}
