#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MinesweeperVsBackendStack } from '../lib/minesweeper-vs-backend-stack';
import { Environment, StackProps } from 'aws-cdk-lib';

if (process.env.AWS_ACCOUNT_ID === undefined) {
  throw new TypeError("Need to define environment variable AWS_ACCOUNT_ID");
}
if (process.env.AWS_REGION === undefined) {
  throw new TypeError("Need to define environment variable AWS_REGION");
}

const DEPLOYMENT_ENV: Environment = {
  account: process.env.AWS_ACCOUNT_ID!,
  region: process.env.AWS_REGION!
};

const DEPLOYMENT_PROPS: StackProps = {
  env: DEPLOYMENT_ENV
}

const app = new cdk.App();
const backendStack = new MinesweeperVsBackendStack(app, 'MinesweeperVsBackendStack', DEPLOYMENT_PROPS);
