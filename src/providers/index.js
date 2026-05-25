import { invalidConfig } from "../utils.js";
import { createAliyunClient } from "./sdk/aliyun.js";
import { createS3Client } from "./sdk/s3.js";

export function createStorageClient(config = {}) {
  const providerType = String(
    config.providerType || config.provider || config.type || config.OSS_PROVIDER || config.STORAGE_PROVIDER || "",
  ).trim().toLowerCase();

  if (!providerType) {
    throw invalidConfig("Missing required config: OSS_PROVIDER (storage provider type, e.g. aliyun or s3)");
  }

  switch (providerType) {
    case "aliyun":
    case "aliyun-oss":
    case "oss":
      return {
        type: "aliyun",
        ...createAliyunClient(config),
      };

    case "s3":
    case "aws-s3":
    case "s3-compatible":
      return {
        type: "s3",
        ...createS3Client(config),
      };

    default:
      throw invalidConfig(`Unsupported storage provider: ${providerType}`);
  }
}
