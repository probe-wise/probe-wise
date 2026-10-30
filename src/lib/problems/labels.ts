import type { ProblemDomain } from "@/lib/problems/types";
import { DOMAINS, labelFor } from "@/lib/profile-options";

export const domainLabel = (d: ProblemDomain) => (d === "general" ? "Classics" : labelFor(DOMAINS, d));
