#!/usr/bin/env tsx

import { Vercel } from '@vercel/sdk';
import { exit } from 'process';

// Colors for output
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  reset: '\x1b[0m',
} as const;

// Logger functions
const log = (message: string) => {
  console.log(`${colors.green}[INFO]${colors.reset} ${message}`);
};

const warn = (message: string) => {
  console.log(`${colors.yellow}[WARN]${colors.reset} ${message}`);
};

const error = (message: string) => {
  console.error(`${colors.red}[ERROR]${colors.reset} ${message}`);
  exit(1);
};

// Required environment variables
const requiredVars = ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID', 'FE_BRANCH'] as const;

// Environment variable validation
const validateEnvironment = () => {
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      error(`Missing required environment variable: ${varName}`);
    }
  }
};

// Initialize configuration
const getConfig = () => {
  validateEnvironment();

  return {
    token: process.env.VERCEL_TOKEN!,
    projectId: process.env.VERCEL_PROJECT_ID!,
    orgId: process.env.VERCEL_ORG_ID!,
    branch: process.env.FE_BRANCH!,
    targetApiUrl: `https://api.pr-${process.env.FE_BRANCH}.deploy-preview.mrdibre.com`,
  };
};

// Initialize Vercel SDK
const initializeVercel = (token: string) => {
  return new Vercel({
    bearerToken: token,
  });
};

// Check for existing deployments
const checkExistingDeployment = async (
  vercel: Vercel,
  projectId: string,
  branch: string
): Promise<string | null> => {
  try {
    log('Checking for existing deployments...');

    const response = await vercel.deployments.getDeployments({
      projectId,
      limit: 50,
    });

    if (!response.deployments) {
      return null;
    }

    // Find deployment matching the branch and in ready/building state
    const existingDeployment = response.deployments.find(deployment => {
      const matchesBranch =
        deployment.meta?.githubCommitRef === branch ||
        deployment.name?.toLowerCase().includes(branch.toLowerCase());

      const isActiveState =
        deployment.state === 'READY' ||
        deployment.state === 'BUILDING';

      return matchesBranch && isActiveState;
    });

    return existingDeployment?.uid || null;
  } catch (err) {
    error(`Failed to fetch deployments: ${err}`);
    return null;
  }
};

// Get environment variable ID
const getEnvVarId = async (
  vercel: Vercel,
  projectId: string
): Promise<string | null> => {
  try {
    log('Fetching VITE_API_URL environment variable ID...');

    const response = await vercel.projects.getEnvironmentVariables({
      idOrName: projectId,
    });

    if (!response.envs) {
      return null;
    }

    const viteApiUrlEnv = response.envs.find(env => env.key === 'VITE_API_URL');
    return viteApiUrlEnv?.id || null;
  } catch (err) {
    error(`Failed to fetch environment variables: ${err}`);
    return null;
  }
};

// Update or create environment variable
const updateEnvVar = async (
  vercel: Vercel,
  projectId: string,
  envVarId: string | null,
  targetApiUrl: string
): Promise<void> => {
  try {
    if (!envVarId) {
      warn('VITE_API_URL environment variable not found, creating new one...');

      await vercel.projects.createEnvironmentVariable({
        idOrName: projectId,
        requestBody: {
          key: 'VITE_API_URL',
          value: targetApiUrl,
          type: 'plain',
          target: ['preview'],
        },
      });

      log('Created new VITE_API_URL environment variable');
    } else {
      log(`Updating VITE_API_URL environment variable (ID: ${envVarId})...`);

      await vercel.projects.editEnvironmentVariable({
        idOrName: projectId,
        id: envVarId,
        requestBody: {
          key: 'VITE_API_URL',
          value: targetApiUrl,
          type: 'plain',
          target: ['preview'],
        },
      });

      log(`Updated VITE_API_URL to: ${targetApiUrl}`);
    }
  } catch (err) {
    error(`Failed to update environment variable: ${err}`);
  }
};

// Create new deployment
const createDeployment = async (
  vercel: Vercel,
  projectId: string,
  branch: string
): Promise<void> => {
  try {
    log('Creating new deployment...');

    const response = await vercel.deployments.createDeployment({
      requestBody: {
        name: `pr-${branch}`,
        project: projectId,
        target: 'preview',
        gitSource: {
          type: 'github',
          ref: branch,
        },
      },
    });

    if (response.url) {
      log('New deployment created successfully!');
      log(`Deployment URL: https://${response.url}`);
      log(`Deployment ID: ${response.uid}`);
    } else {
      log('Deployment triggered successfully');
    }
  } catch (err) {
    error(`Failed to create new deployment: ${err}`);
  }
};

// Redeploy existing deployment
const redeployExisting = async (
  vercel: Vercel,
  existingDeploymentId: string
): Promise<void> => {
  try {
    log(`Redeploying existing deployment (ID: ${existingDeploymentId})...`);

    const response = await vercel.deployments.createDeployment({
      requestBody: {
        deploymentId: existingDeploymentId,
        target: 'preview',
      },
    });

    if (response.url) {
      log('Redeployment triggered successfully!');
      log(`Deployment URL: https://${response.url}`);
      log(`Deployment ID: ${response.uid}`);
    } else {
      log('Redeployment triggered successfully');
    }
  } catch (err) {
    warn('Failed to redeploy existing deployment, creating new one instead...');
    // Fall back to creating new deployment - we'll need the config again
    const config = getConfig();
    const vercelClient = initializeVercel(config.token);
    await createDeployment(vercelClient, config.projectId, config.branch);
  }
};

// Main execution function
const main = async (): Promise<void> => {
  try {
    const config = getConfig();

    log(`Starting Vercel deployment management for branch: ${config.branch}`);
    log(`Target API URL: ${config.targetApiUrl}`);

    // Initialize Vercel SDK
    const vercel = initializeVercel(config.token);

    // Step 1: Check for existing deployments
    const existingDeployment = await checkExistingDeployment(
      vercel,
      config.projectId,
      config.branch
    );

    // Step 2: Update environment variable
    const envVarId = await getEnvVarId(vercel, config.projectId);
    await updateEnvVar(vercel, config.projectId, envVarId, config.targetApiUrl);

    // Step 3: Deploy or redeploy
    if (existingDeployment) {
      log(`Found existing deployment: ${existingDeployment}`);
      await redeployExisting(vercel, existingDeployment);
    } else {
      log(`No existing deployment found for branch: ${config.branch}`);
      await createDeployment(vercel, config.projectId, config.branch);
    }

    log('Vercel deployment process completed successfully!');
  } catch (err) {
    error(`Deployment process failed: ${err}`);
  }
};

main()
