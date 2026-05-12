import { prisma } from './db';

const TRADING_CONTROL_ID = 1;

export async function getTradingControl(): Promise<{ binanceExecutionOn: boolean }> {
  try {
    let row = await prisma.tradingControl.findUnique({
      where: { id: TRADING_CONTROL_ID },
    });
    if (!row) {
      row = await prisma.tradingControl.create({
        data: { binanceExecutionOn: true },
      });
    }
    return { binanceExecutionOn: row.binanceExecutionOn };
  } catch (e) {
    console.error('[getTradingControl]', e);
    return { binanceExecutionOn: true };
  }
}

export async function setBinanceExecutionOn(on: boolean): Promise<{ binanceExecutionOn: boolean }> {
  const row = await prisma.tradingControl.upsert({
    where: { id: TRADING_CONTROL_ID },
    create: { binanceExecutionOn: on },
    update: { binanceExecutionOn: on },
  });
  return { binanceExecutionOn: row.binanceExecutionOn };
}
