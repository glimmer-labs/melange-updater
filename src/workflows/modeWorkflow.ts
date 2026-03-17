import { RuntimeInputs } from '../core/inputs';
import { bumpWithMelangeTool } from '../integrations/melange';
import { PackageError, PackageMap, WorkflowContext } from './types';
import { UpdateMap } from '../types';

export async function handleNonPrModes(
  ctx: WorkflowContext,
  inputs: RuntimeInputs,
  packages: PackageMap,
  updates: UpdateMap,
  packageErrors: PackageError[]
): Promise<boolean> {
  const updateEntries = Object.entries(updates);

  if (updateEntries.length === 0) {
    ctx.logger.info('No updates detected. Exiting without creating a branch.');
    if (inputs.dryRun) ctx.logger.info('Dry run mode: nothing was changed.');
    return true;
  }

  if (inputs.dryRun) {
    ctx.logger.info('Dry run enabled - the following updates would be applied:');
    ctx.logger.info(JSON.stringify(updates, null, 2));
    return true;
  }

  if (inputs.preview) {
    for (const [name, u] of Object.entries(updates)) {
      if (u.manual) continue;
      const pkg = packages[name];
      if (!pkg) continue;
      bumpWithMelangeTool({ repoPath: ctx.absRepoPath, packageFile: pkg.file, version: u.to, expectedCommit: u.commit });
    }
    ctx.logger.info('Preview mode: updates applied locally; no branch/commit/push/PR.');
    return true;
  }

  void packageErrors;
  return false;
}
