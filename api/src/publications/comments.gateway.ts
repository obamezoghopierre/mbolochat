import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { corsOrigin, socketAllowRequest } from '../common/cors.js';
import { authenticateSocket } from '../chat/socket-auth.js';
import { FEED_STATS_ROOM, PublicationEvents } from './publication-events.js';
import { PublicationsService } from './publications.service.js';

/**
 * Salon temps réel des commentaires : `comments:join` n'est accepté qu'après
 * `assertVisible` — un compte qui ne voit pas la publication ne reçoit ni le
 * contenu des commentaires ni leurs mises à jour.
 */
@WebSocketGateway({ cors: { origin: corsOrigin, credentials: true }, allowRequest: socketAllowRequest })
export class CommentsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly publications: PublicationsService,
    private readonly events: PublicationEvents,
  ) {}

  afterInit(server: Server) {
    this.events.attachServer(server);
  }

  async handleConnection(client: Socket) {
    await authenticateSocket(client, this.jwtService);
    // Compteurs du fil en temps réel : joint une fois pour toute la session.
    await client.join(FEED_STATS_ROOM);
  }

  @SubscribeMessage('comments:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { publicationId?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    const publicationId = body?.publicationId;
    if (!userId || !publicationId) {
      throw new WsException('Publication requise.');
    }
    await this.publications.assertVisiblePublication(publicationId, userId);
    await client.join(`comments:${publicationId}`);
    return { joined: publicationId };
  }

  @SubscribeMessage('comments:leave')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { publicationId?: string },
  ) {
    const publicationId = body?.publicationId;
    if (publicationId) {
      await client.leave(`comments:${publicationId}`);
    }
    return { left: publicationId ?? null };
  }
}
