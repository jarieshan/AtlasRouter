import { ASSETS } from "./generated/assets.js";
import { HttpError } from "./errors.js";

export function repositoryTemplate(ref = "master") {
  if (!["master", "develop"].includes(ref)) {
    throw new HttpError(503, "Repository rule reference is not configured correctly");
  }
  return ASSETS.template.replaceAll("{{REPOSITORY_RULES_REF}}", ref);
}
