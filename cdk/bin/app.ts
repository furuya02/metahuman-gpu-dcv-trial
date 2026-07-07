#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MetahumanGpuDcvTrialStack } from "../lib/stack";

const app = new cdk.App();

new MetahumanGpuDcvTrialStack(app, "MetahumanGpuDcvTrialStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
  },
});
