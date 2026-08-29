export interface ChannelPublication {
  externalId: string;
  externalUrl: string;
}

export interface ChannelPublisher {
  readonly channelId: string;
  executeApproved(opportunityId: string): Promise<ChannelPublication>;
  syncOutcomes(): Promise<number>;
}

export class ChannelPublisherRegistry {
  private readonly publishers = new Map<string, ChannelPublisher>();

  constructor(publishers: ChannelPublisher[]) {
    for (const publisher of publishers) {
      if (this.publishers.has(publisher.channelId)) throw new Error(`Duplicate channel publisher: ${publisher.channelId}`);
      this.publishers.set(publisher.channelId, publisher);
    }
  }

  require(channelId: string): ChannelPublisher {
    const publisher = this.publishers.get(channelId);
    if (!publisher) throw new Error("This channel does not have a verified publishing connector. Copy the approved draft and complete it manually.");
    return publisher;
  }
}
