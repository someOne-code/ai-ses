import { env } from "../../config/env.js";

import type { CrmWebhookDispatchContract } from "./types.js";

const N8N_TRIGGER_SECRET_HEADER = "x-ai-ses-trigger-secret";

type FetchLike = typeof fetch;

type DispatchLogger = {
  warn: (payload: unknown, message?: string) => void;
};

export interface CrmWorkflowDispatcher {
  dispatchCrmWebhook(contract: CrmWebhookDispatchContract): Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getTriggerPath(config: unknown): string | null {
  const record = asRecord(config);
  const triggerUrl = record?.triggerUrl;

  if (typeof triggerUrl === "string" && triggerUrl.trim() !== "") {
    try {
      return new URL(triggerUrl).pathname;
    } catch {
      return null;
    }
  }

  const triggerPath = record?.triggerPath;

  if (typeof triggerPath !== "string") {
    return null;
  }

  const normalized = triggerPath.trim();

  if (!normalized.startsWith("/")) {
    return null;
  }

  return normalized;
}

function resolveTriggerUrl(baseUrl: string | undefined, config: unknown) {
  const triggerPath = getTriggerPath(config);

  if (!baseUrl || !triggerPath) {
    return null;
  }

  return new URL(triggerPath, baseUrl).toString();
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeDispatchBody(contract: CrmWebhookDispatchContract) {
  return {
    kind: contract.kind,
    office: contract.office,
    entity: contract.entity,
    event: contract.event,
    connection: contract.connection
  };
}

export function createCrmWorkflowDispatcher(
  options: {
    baseUrl?: string;
    triggerSecret?: string;
    fetchFn?: FetchLike;
    logger?: DispatchLogger;
  } = {}
): CrmWorkflowDispatcher {
  const baseUrl = options.baseUrl ?? env.N8N_BASE_URL;
  const triggerSecret = options.triggerSecret ?? env.N8N_CRM_TRIGGER_SECRET;
  const fetchFn = options.fetchFn ?? fetch;
  const logger = options.logger;

  return {
    async dispatchCrmWebhook(contract) {
      const triggerUrl = resolveTriggerUrl(baseUrl, contract.connection.config);

      if (!triggerUrl) {
        throw new Error("CRM workflow triggerPath is not configured.");
      }

      if (!triggerSecret) {
        throw new Error("N8N_CRM_TRIGGER_SECRET is not configured.");
      }

      const response = await fetchFn(triggerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [N8N_TRIGGER_SECRET_HEADER]: triggerSecret
        },
        body: JSON.stringify(serializeDispatchBody(contract))
      });

      if (response.ok) {
        return;
      }

      let details: unknown = null;

      try {
        details = await response.json();
      } catch {
        details = await response.text().catch(() => null);
      }

      logger?.warn(
        {
          event: "crm_workflow_dispatch_failed",
          status: response.status,
          triggerUrl,
          details: isJsonObject(details) || typeof details === "string" ? details : null
        },
        "CRM workflow dispatch failed."
      );

      throw new Error(`CRM workflow dispatch failed with status ${response.status}.`);
    }
  };
}

export function createN8nCrmWorkflowDispatcherFromEnv(
  options: {
    fetchFn?: FetchLike;
    logger?: DispatchLogger;
  } = {}
) {
  if (!env.N8N_BASE_URL || !env.N8N_CRM_TRIGGER_SECRET) {
    return undefined;
  }

  return createCrmWorkflowDispatcher({
    baseUrl: env.N8N_BASE_URL,
    triggerSecret: env.N8N_CRM_TRIGGER_SECRET,
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    ...(options.logger ? { logger: options.logger } : {})
  });
}
