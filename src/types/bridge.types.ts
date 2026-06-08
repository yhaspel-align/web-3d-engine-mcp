/** Semantic engine API command names dispatched through the bridge */
export type BridgeCommandMethod =
  | 'get_engine_snapshot'
  | 'get_engine_context'
  | 'get_plugin_presets'
  | 'get_feature_flags'
  | 'get_render_views'
  | 'get_plugin_sync_state'
  | 'get_review_tool_state'
  | 'dispatch_engine_action'
  | 'update_engine_context'
  | 'update_plugin_preset'
  | 'call_store_action';

export interface BridgeCommand {
  /** UUID for correlating request/response pairs */
  id: string;
  /** Semantic engine API command to invoke */
  method: string;
  /** Arguments for the command (serializable) */
  params: unknown;
}

export interface BridgeResponse {
  /** Matches the id from the originating BridgeCommand */
  id: string;
  /** Return value from the command */
  result?: unknown;
  /** Error message if the call failed */
  error?: string;
}

/** Events forwarded from the engine's EngineEventsEnum */
export interface BridgeEvent {
  type: 'engine-event';
  eventName: string;
  detail: unknown;
}

export type BridgeMessage = BridgeResponse | BridgeEvent;
