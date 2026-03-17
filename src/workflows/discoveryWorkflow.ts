import { RuntimeInputs } from '../core/inputs';
import { redactSecrets } from '../core/actionUtils';
import { discoverPackageUpdate } from '../discovery/versionDiscovery';
import { findMelangePackages } from '../integrations/melange';
import { UpdateMap } from '../types';
import { reportPackageFailure } from './failureWorkflow';
import { DiscoveryResult, PackageError, WorkflowContext } from './types';

export async function discoverUpdates(ctx: WorkflowContext, inputs: RuntimeInputs): Promise<DiscoveryResult> {
  const packages = findMelangePackages(ctx.absRepoPath);
  ctx.logger.info('Found', Object.keys(packages).length, 'candidate melange packages');

  const updates: UpdateMap = {};
  const packageErrors: PackageError[] = [];

  for (const [name, pkg] of Object.entries(packages)) {
    const pkgLogger = ctx.logger.child(`discover:${name}`);
    try {
      const update = await discoverPackageUpdate({
        name,
        pkg,
        octo: ctx.octo,
        releaseMonitorToken: inputs.releaseMonitorToken,
        logger: pkgLogger,
      });

      if (update) {
        updates[name] = update;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const safeMsg = redactSecrets(msg);
      pkgLogger.warn(`failed to process package: ${safeMsg}`);
      packageErrors.push({ name, phase: 'version discovery', message: safeMsg });

      if (!inputs.dryRun && !inputs.preview) {
        await reportPackageFailure(ctx, inputs, name, 'version discovery', safeMsg);
      }
    }
  }

  return { packages, updates, packageErrors };
}
