import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { decrypt } from '../lib/encryption';

export interface Provider {
  id: string;
  provider_name: string;
  model_name: string;
  api_key_encrypted: string | null;
  is_active: boolean;
  priority: number;
  monthly_limit: number;
  created_at: string;
}

class ModelRouterService {
  /**
   * Returns all active providers sorted by priority desc, created_at asc
   */
  async getActiveProviders(): Promise<Provider[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('llm_providers')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Error fetching active providers:', { error: error.message });
        return [];
      }

      return data as Provider[];
    } catch (err: any) {
      logger.error('Fatal error in getActiveProviders:', { error: err.message });
      return [];
    }
  }

  /**
   * Returns the primary active provider (highest priority) with its API key decrypted.
   */
  async getPreferredProvider(): Promise<(Provider & { api_key: string | null }) | null> {
    const providers = await this.getActiveProviders();
    if (providers.length === 0) return null;

    const preferred = providers[0];
    let decryptedKey: string | null = null;
    
    if (preferred.api_key_encrypted) {
      try {
        decryptedKey = decrypt(preferred.api_key_encrypted);
      } catch (err: any) {
        logger.error(`Decryption failed for provider key (${preferred.provider_name}):`, { error: err.message });
      }
    }

    return {
      ...preferred,
      api_key: decryptedKey
    };
  }

  /**
   * De-activates or deprioritizes the failing provider and returns the next best provider.
   */
  async failoverProvider(failingProviderId: string): Promise<(Provider & { api_key: string | null }) | null> {
    logger.warn(`Initiating failover sequence for failing provider: ${failingProviderId}`);
    try {
      // Deactivate the failing provider (or lower its priority)
      const { error } = await supabaseAdmin
        .from('llm_providers')
        .update({ is_active: false })
        .eq('id', failingProviderId);

      if (error) {
        logger.error(`Failed to deactivate provider ${failingProviderId}:`, { error: error.message });
      }

      // Fetch the new preferred provider
      return this.getPreferredProvider();
    } catch (err: any) {
      logger.error(`Fatal error in failoverProvider:`, { error: err.message });
      return null;
    }
  }

  /**
   * Cycles priority of providers to balance loads.
   */
  async rotateProvider(): Promise<void> {
    try {
      const providers = await this.getActiveProviders();
      if (providers.length <= 1) return;

      // Move the highest priority provider to the lowest priority among active ones
      const highest = providers[0];
      const lowestPriority = providers[providers.length - 1].priority;
      const newPriority = Math.max(0, lowestPriority - 1);

      const { error } = await supabaseAdmin
        .from('llm_providers')
        .update({ priority: newPriority })
        .eq('id', highest.id);

      if (error) {
        logger.error(`Failed to rotate provider ${highest.id}:`, { error: error.message });
      } else {
        logger.info(`Successfully rotated provider ${highest.provider_name} to priority ${newPriority}`);
      }
    } catch (err: any) {
      logger.error('Fatal error in rotateProvider:', { error: err.message });
    }
  }
}

export const modelRouterService = new ModelRouterService();
export default modelRouterService;
