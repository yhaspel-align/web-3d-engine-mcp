export interface BridgeCommand {
  /** UUID for correlating request/response pairs */
  id: string;
  /** IThreeObjectsService method name to invoke */
  method: string;
  /** Arguments to pass to the method (serializable) */
  params: unknown;
}

export interface BridgeResponse {
  /** Matches the id from the originating BridgeCommand */
  id: string;
  /** Return value from the service method (ThreeServiceResponse or typed return) */
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
