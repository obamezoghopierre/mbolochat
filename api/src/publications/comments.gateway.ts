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
import { feedPostRoomOf, PublicationEvents } from './publication-events.js';
import { PublicationsService } from './publications.service.js';

/**
 * Salon temps réel des commentaires : `comments:join` n'est accepté qu'après
 * `assertVisible` — un compte qui ne voit pas la publication ne reçoit ni le
 * contenu des commentaires ni leurs mises à jour.
 */
@WebSocketGateway({
  cors: { origin: corsOrigin, credentials: true },
  allowRequest: socketAllowRequest,
})
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
    // Authentifie et joint le salon personnel `user:<id>` du compte.
    await authenticateSocket(client, this.jwtService);
  }

  /** Rejoint les compteurs d'une publication après contrôle d'autorisation. */
  @SubscribeMessage('feed:join')
  async joinFeed(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { publicationId?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    const publicationId = body?.publicationId;
    if (!userId || typeof publicationId !== 'string' || !publicationId) {
      throw new WsException('Publication requise.');
    }
    await this.publications.assertVisiblePublication(publicationId, userId);
    await client.join(feedPostRoomOf(publicationId));
    return { joined: publicationId };
  }

  /** Quitte les compteurs d'une publication ; aucun accès n'est requis. */
  @SubscribeMessage('feed:leave')
  async leaveFeed(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { publicationId?: string },
  ) {
    const publicationId = body?.publicationId;
    if (typeof publicationId === 'string' && publicationId) {
      await client.leave(feedPostRoomOf(publicationId));
    }
    return { left: publicationId ?? null };
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
