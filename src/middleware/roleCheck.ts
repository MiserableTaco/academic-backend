import { FastifyRequest, FastifyReply } from 'fastify';

export function requireRole(...allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;
    
    if (!user || !user.role) {
      return reply.code(403).send({ error: 'No role assigned' });
    }
    
    if (!allowedRoles.includes(user.role)) {
      return reply.code(403).send({ 
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}` 
      });
    }
  };
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as any;
  if (user?.role !== 'ADMIN') {
    return reply.code(403).send({ error: 'Admin access required' });
  }
}

export function requireIssuerOrAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as any;
  if (user?.role !== 'ISSUER' && user?.role !== 'ADMIN') {
    return reply.code(403).send({ error: 'Issuer or Admin access required' });
  }
}
