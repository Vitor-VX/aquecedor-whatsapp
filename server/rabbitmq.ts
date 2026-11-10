import amqp, { type Channel, type ChannelModel } from 'amqplib';

const rabbitUrl = () => process.env.RABBITMQ_URL?.trim() || '';
const queueName = () => process.env.RABBITMQ_QUEUE?.trim() || 'aquecedor.jobs';
let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let connecting: Promise<Channel | null> | null = null;

export const rabbitConfigured = () => Boolean(rabbitUrl());

async function getChannel(): Promise<Channel | null> {
  if (!rabbitConfigured()) return null;
  if (channel) return channel;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      const currentConnection = await amqp.connect(rabbitUrl());
      connection = currentConnection;
      currentConnection.on('close', () => { connection = null; channel = null; });
      currentConnection.on('error', (error: Error) => console.error('[RabbitMQ]', error.message));
      const currentChannel = await currentConnection.createChannel();
      channel = currentChannel;
      await currentChannel.assertQueue(queueName(), { durable: true });
      await currentChannel.prefetch(Number(process.env.RABBITMQ_PREFETCH || 2));
      console.log(`[RabbitMQ] fila ${queueName()} conectada`);
      return currentChannel;
    } catch (error: any) {
      console.error('[RabbitMQ] conexão indisponível:', error.message);
      connection = null;
      channel = null;
      return null;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

export async function publishWarmupJob(jobId: string): Promise<boolean> {
  const currentChannel = await getChannel();
  if (!currentChannel) return false;
  return currentChannel.sendToQueue(queueName(), Buffer.from(JSON.stringify({ jobId })), {
    persistent: true,
    contentType: 'application/json',
  });
}

export async function startRabbitConsumer(handler: (jobId: string) => Promise<void>): Promise<boolean> {
  const currentChannel = await getChannel();
  if (!currentChannel) return false;
  await currentChannel.consume(queueName(), async (message) => {
    if (!message) return;
    try {
      const payload = JSON.parse(message.content.toString()) as { jobId?: string };
      if (payload.jobId) await handler(payload.jobId);
      currentChannel.ack(message);
    } catch (error: any) {
      console.error('[RabbitMQ] falha ao processar mensagem:', error.message);
      currentChannel.nack(message, false, true);
    }
  });
  return true;
}

