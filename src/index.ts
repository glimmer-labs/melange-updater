#!/usr/bin/env node

import minimist from 'minimist';
import * as core from '@actions/core';
import { failAndExit, writeSummary } from './core/actionUtils';
import { collectRuntimeInputs, validateRuntimeInputs } from './core/inputs';
import { createWorkflowContext } from './workflows/contextWorkflow';
import { discoverUpdates } from './workflows/discoveryWorkflow';
import { handleNonPrModes } from './workflows/modeWorkflow';
import { runPrWorkflow } from './workflows/prWorkflow';
import { UpdateEntry } from './types';
import { createLogger } from './core/logger';

const logger = createLogger('index');

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2));
  const inputs = collectRuntimeInputs(argv);

  const validationError = validateRuntimeInputs(inputs);
  if (validationError) {
    failAndExit(validationError);
  }

  const workflowContext = createWorkflowContext(inputs);

  const discovery = await discoverUpdates(workflowContext, inputs);
  const modeHandled = await handleNonPrModes(
    workflowContext,
    inputs,
    discovery.packages,
    discovery.updates,
    discovery.packageErrors
  );
  if (modeHandled) {
    const updateEntries = Object.entries(discovery.updates);
    const manualUpdates = updateEntries.filter(([, u]) => u.manual) as Array<[string, UpdateEntry]>;
    const mode = updateEntries.length === 0 ? 'no-updates' : inputs.dryRun ? 'dry-run' : 'preview';
    await writeSummary({ mode, updates: discovery.updates, manualUpdates, packageErrors: discovery.packageErrors });
    return;
  }

  const updateEntries = Object.entries(discovery.updates);
  const manualUpdates = updateEntries.filter(([, u]) => u.manual) as Array<[string, UpdateEntry]>;
  const nonManualUpdates = updateEntries.filter(([, u]) => !u.manual) as Array<[string, UpdateEntry]>;

  if (nonManualUpdates.length === 0) {
    logger.info('Only manual updates detected; nothing to auto-apply.');
    await writeSummary({ mode: 'manual-only', updates: discovery.updates, manualUpdates, packageErrors: discovery.packageErrors });
    return;
  }

  const prResult = await runPrWorkflow(workflowContext, inputs, discovery.packages, nonManualUpdates);
  const allErrors = [...discovery.packageErrors, ...prResult.packageErrors];

  if (manualUpdates.length > 0) {
    logger.info(
      'Manual updates were detected and not auto-applied:',
      manualUpdates.map(([n, update]) => `${n} (${update.from} -> ${update.to})`).join(', ')
    );
  }

  logger.info(`PRs created: ${prResult.createdPRs.length}`);
  prResult.createdPRs.forEach((p: { name: string; url: string }) => logger.info(`- ${p.name}: ${p.url}`));

  if (prResult.failedPackages.length) {
    logger.warn(`Packages that failed to push/PR: ${prResult.failedPackages.join(', ')}`);
  }

  logger.info('Done.');

  await writeSummary({
    mode: 'pr',
    updates: discovery.updates,
    createdPRs: prResult.createdPRs,
    manualUpdates,
    failedPackages: prResult.failedPackages,
    packageErrors: allErrors,
  });
}

main().catch((err) => {
  logger.error(err);
  try {
    core.setFailed((err as Error).message || String(err));
  } catch (_) {
    // Ignore when core is unavailable in CLI mode.
  }
  process.exit(1);
});
