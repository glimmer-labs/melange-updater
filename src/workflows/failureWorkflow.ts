import { RuntimeInputs } from '../core/inputs';
import { createIssueForPackage } from '../integrations/githubActions';
import { WorkflowContext } from './types';

export async function reportPackageFailure(
  ctx: WorkflowContext,
  inputs: RuntimeInputs,
  pkgName: string,
  phase: string,
  safeMessage: string
): Promise<void> {
  const issueKey = `${pkgName}|${phase}`;
  if (ctx.issueTracker.has(issueKey)) {
    return;
  }

  await createIssueForPackage({
    octo: ctx.octo,
    targetRepo: inputs.targetRepo,
    token: inputs.token,
    pkgName,
    message: safeMessage,
    phase,
  });
  ctx.issueTracker.add(issueKey);
}
