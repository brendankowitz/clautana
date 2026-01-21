/**
 * Example usage of the Backend Abstraction Layer
 * 
 * This file demonstrates how to use the backend abstraction layer
 * to create AI agent sessions with different backends.
 */

import { createBackend, SessionConfig, ToolDefinition } from './index';

/**
 * Example 1: Basic Claude backend usage
 */
export async function exampleBasicClaudeUsage() {
  console.log('=== Example 1: Basic Claude Usage ===');

  // Create a Claude backend
  const backend = createBackend('claude');

  // Create a session
  const session = await backend.createSession({
    workingDirectory: process.cwd(),
    systemPrompt: 'You are a helpful coding assistant.',
    model: 'claude-sonnet-4-20250514',
  });

  console.log(`Session created: ${session.id} (backend: ${session.backendType})`);

  // Send a prompt and process responses
  for await (const message of session.send('Hello! Can you help me?')) {
    console.log(`[${message._backend}] ${message.type}:`, message.content || message.toolCall?.name);

    if (message.type === 'complete') {
      console.log('Conversation completed!');
      break;
    }
  }

  // Cleanup
  await session.destroy();
  await backend.dispose();
}

/**
 * Example 2: Using tools with the backend
 */
export async function exampleWithTools() {
  console.log('\n=== Example 2: Backend with Tools ===');

  // Define tools
  const tools: ToolDefinition[] = [
    {
      name: 'get_current_time',
      description: 'Get the current time',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      handler: async () => {
        return new Date().toISOString();
      },
    },
    {
      name: 'calculate',
      description: 'Perform a calculation',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['add', 'subtract', 'multiply', 'divide'],
            description: 'The operation to perform',
          },
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['operation', 'a', 'b'],
      },
      handler: async (args: Record<string, unknown>) => {
        const { operation, a, b } = args as { operation: string; a: number; b: number };
        switch (operation) {
          case 'add':
            return a + b;
          case 'subtract':
            return a - b;
          case 'multiply':
            return a * b;
          case 'divide':
            return a / b;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
      },
    },
  ];

  // Create backend with tools
  const backend = createBackend('claude');
  const session = await backend.createSession({
    workingDirectory: process.cwd(),
    systemPrompt: 'You are a helpful assistant with access to tools.',
    tools,
  });

  // Use the tools
  for await (const message of session.send('What time is it? Also, what is 15 + 27?')) {
    if (message.type === 'text') {
      console.log(`Assistant: ${message.content}`);
    } else if (message.type === 'toolCall') {
      console.log(`Tool called: ${message.toolCall?.name}`, message.toolCall?.arguments);
    }
  }

  await session.destroy();
  await backend.dispose();
}

/**
 * Example 3: Using multiple backends (when Copilot is implemented)
 */
export async function exampleMultipleBackends() {
  console.log('\n=== Example 3: Multiple Backends (Future) ===');

  const config: SessionConfig = {
    workingDirectory: process.cwd(),
    systemPrompt: 'You are a code review assistant.',
  };

  // Create different backends
  const claudeBackend = createBackend('claude');
  const claudeSession = await claudeBackend.createSession({
    ...config,
    model: 'claude-opus-4-20250514', // Premium model
  });

  console.log(`Claude session: ${claudeSession.id} (${claudeSession.backendType})`);

  // When Copilot is implemented:
  // const copilotBackend = createBackend('copilot');
  // const copilotSession = await copilotBackend.createSession({
  //   ...config,
  //   model: 'gpt-5',
  // });
  // console.log(`Copilot session: ${copilotSession.id} (${copilotSession.backendType})`);

  // Use sessions based on task requirements
  // - Heavy reasoning: Use Claude Opus
  // - Quick tasks: Use GPT-5 via Copilot
  // - Code completion: Use Copilot native models

  await claudeSession.destroy();
  await claudeBackend.dispose();
}

/**
 * Example 4: Error handling
 */
export async function exampleErrorHandling() {
  console.log('\n=== Example 4: Error Handling ===');

  const backend = createBackend('claude');

  try {
    const session = await backend.createSession({
      workingDirectory: process.cwd(),
      systemPrompt: 'Test session',
    });

    for await (const message of session.send('Test prompt')) {
      if (message.type === 'error') {
        console.error('Error received:', message.error?.message);
        break;
      }
    }

    await session.destroy();
  } catch (error) {
    console.error('Session creation failed:', error);
  } finally {
    await backend.dispose();
  }
}

/**
 * Example 5: Abort handling
 */
export async function exampleAbort() {
  console.log('\n=== Example 5: Abort Handling ===');

  const backend = createBackend('claude');
  const session = await backend.createSession({
    workingDirectory: process.cwd(),
    systemPrompt: 'Test session',
  });

  const abortController = new AbortController();

  // Start processing
  const processPromise = (async () => {
    try {
      for await (const message of session.send('Write a very long story...', {
        abortController,
      })) {
        console.log(`Received: ${message.type}`);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('Operation was aborted');
      } else {
        throw error;
      }
    }
  })();

  // Abort after 1 second
  setTimeout(() => {
    console.log('Aborting operation...');
    abortController.abort();
  }, 1000);

  await processPromise;
  await session.destroy();
  await backend.dispose();
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  try {
    await exampleBasicClaudeUsage();
    await exampleWithTools();
    await exampleMultipleBackends();
    await exampleErrorHandling();
    await exampleAbort();
    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

// Uncomment to run examples:
// runAllExamples().catch(console.error);
