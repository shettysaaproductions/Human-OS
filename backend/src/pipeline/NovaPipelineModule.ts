/**
 * NovaPipelineModule.ts — Standard Module Contract and Registry (Phase 1)
 *
 * ARCHITECTURAL INVARIANT:
 * 11. EVERY FEATURE = PIPELINE MODULE
 * Every capability exposes a predictable contract:
 * INPUT → PROCESSOR → OUTPUT → EVENTS EMITTED → MEMORY EFFECT → DEPENDENCIES → PERMISSIONS/REQUIREMENTS
 */

import { NovaInputEvent, FactOrEntityKind, NovaProvenance } from './NovaEvent';
import { NovaPipelineContext } from './NovaContext';
import { logger } from '../lib/logger';

/**
 * Declared memory mutation or fact update emitted by a module.
 * Feeds into the continuous memory reconciliation phase.
 */
export interface MemoryEffect {
  kind: FactOrEntityKind;
  action: 'create' | 'update' | 'merge' | 'move' | 'correct' | 'archive' | 'delete';
  subjectEntityId: string;       // e.g. "entity:person_shreshth"
  subjectEntityName: string;     // e.g. "Shreshth"
  predicate?: string;            // e.g. "birth_date", "occupation"
  value?: string;                // e.g. "1995-04-12", "Doctor"
  domainKey?: string;            // Taxonomic namespace: "family", "work", "lifestyle"
  relationType?: string;         // e.g. "Son", "Wife"
  parentBubbleId?: string;       // Topological parent in bubble hierarchy
  provenance: NovaProvenance;
  confidence: number;
}

/**
 * Standard output artifact returned by a pipeline module.
 */
export interface NovaModuleOutput {
  replyText?: string;
  options?: string[];
  audioBase64?: string;
  audioDurationSec?: number;
  toolResults?: Array<{ toolName: string; args?: unknown; result: unknown }>;
  clientPayload?: Record<string, unknown>;
}

/**
 * Complete result envelope produced by a pipeline module execution.
 */
export interface NovaModuleResult<T = unknown> {
  success: boolean;
  output?: NovaModuleOutput;
  data?: T;
  emittedEvents: NovaInputEvent[];
  memoryEffects: MemoryEffect[];
  contextUpdates?: Partial<NovaPipelineContext>;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

/**
 * Core Nova OS Pipeline Module Interface.
 */
export interface NovaPipelineModule<TOutput = unknown> {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies: string[];
  readonly requirements: {
    permissions?: string[];
    platformSupport?: ('server' | 'android' | 'ios')[];
    requiresAuth?: boolean;
  };

  /**
   * Evaluates if this module is eligible to process the incoming event.
   */
  canHandle(event: NovaInputEvent, context: NovaPipelineContext): boolean;

  /**
   * Executes the module logic.
   */
  process(event: NovaInputEvent, context: NovaPipelineContext): Promise<NovaModuleResult<TOutput>>;

  /**
   * Optional lifecycle hooks.
   */
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}

/**
 * Singleton Module Registry with dependency resolution.
 */
export class NovaModuleRegistry {
  private static instance: NovaModuleRegistry;
  private modules = new Map<string, NovaPipelineModule>();

  static getInstance(): NovaModuleRegistry {
    if (!NovaModuleRegistry.instance) {
      NovaModuleRegistry.instance = new NovaModuleRegistry();
    }
    return NovaModuleRegistry.instance;
  }

  register(module: NovaPipelineModule): void {
    if (this.modules.has(module.name)) {
      logger.warn('[ModuleRegistry] Overwriting registered module', { name: module.name });
    }
    this.modules.set(module.name, module);
    logger.info('[ModuleRegistry] Module registered', {
      name: module.name,
      version: module.version,
      dependencies: module.dependencies,
    });
  }

  unregister(name: string): boolean {
    return this.modules.delete(name);
  }

  get(name: string): NovaPipelineModule | undefined {
    return this.modules.get(name);
  }

  listModules(): NovaPipelineModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Returns registered modules sorted topologically by dependencies.
   */
  getExecutionOrder(): NovaPipelineModule[] {
    const visited = new Set<string>();
    const order: NovaPipelineModule[] = [];
    const visiting = new Set<string>();

    const visit = (name: string) => {
      if (visiting.has(name)) {
        logger.error('[ModuleRegistry] Circular module dependency detected', { cycleNode: name });
        return;
      }
      if (visited.has(name)) return;

      const mod = this.modules.get(name);
      if (!mod) {
        logger.warn('[ModuleRegistry] Missing module dependency', { missingDependency: name });
        return;
      }

      visiting.add(name);
      for (const dep of mod.dependencies) {
        visit(dep);
      }
      visiting.delete(name);
      visited.add(name);
      order.push(mod);
    };

    for (const name of this.modules.keys()) {
      if (!visited.has(name)) {
        visit(name);
      }
    }

    return order;
  }

  /**
   * Finds the primary module capable of handling an input event.
   */
  findHandler(event: NovaInputEvent, context: NovaPipelineContext): NovaPipelineModule | undefined {
    for (const mod of this.modules.values()) {
      if (mod.canHandle(event, context)) {
        return mod;
      }
    }
    return undefined;
  }
}

export const novaModuleRegistry = NovaModuleRegistry.getInstance();
