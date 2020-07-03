// Copyright (c) 2018-2020, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { Block } from './Block';
import { Transaction } from './Transaction';
import { BigInteger } from './Types';

/** @ignore */
export enum SIZES {
    KEY = 32,
    CHECKSUM = 4,
}

declare namespace Interfaces {
    /**
     * The daemon block template response
     */
    interface DaemonBlockTemplateResponse {
        /**
         * The block template supplied by the daemon
         */
        blocktemplate: string;
        /**
         * The blocktemplate difficulty supplied by the daemon
         */
        difficulty: number;
        /**
         * The blocktemplate height supplied by the daemon
         */
        height: number;
        /**
         * The reserved offset position for the blocktemplate supplied by the daemon
         */
        reservedOffset: number;
    }
}

/**
 * Represents a BlockTemplate received from a Daemon that can be manipulated to perform mining operations
 */
export class BlockTemplate {
    /**
     * The major block version for which to activate the use of parent blocks
     */
    public get activateParentBlockVersion (): number {
        return this.m_block.activateParentBlockVersion;
    }

    public set activateParentBlockVersion (value: number) {
        this.m_block.activateParentBlockVersion = value;
    }

    /**
     * The original block template as a buffer
     */
    public get blockTemplateBuffer (): Buffer {
        return this.m_blockTemplate;
    }

    /**
     * The original block template in hexadecimal (blob)
     */
    public get blockTemplate (): string {
        return this.blockTemplateBuffer.toString('hex');
    }

    /**
     * The block template difficulty
     */
    public get difficulty (): number {
        return this.m_difficulty;
    }

    /**
     * The block template height
     */
    public get height (): number {
        return this.m_height;
    }

    /**
     * The block template reserved offset position
     */
    public get reservedOffset (): number {
        return this.m_reservedOffset;
    }

    /**
     * The block nonce
     */
    public get nonce (): number {
        return this.m_block.nonce;
    }

    public set nonce (value: number) {
        this.m_block.nonce = value;
    }

    /**
     * The block defined in the block template
     */
    public get block (): Block {
        return this.m_block;
    }

    /**
     * The miner transaction defined in the block of the block template
     */
    public get minerTransaction (): Transaction {
        return this.m_block.minerTransaction;
    }

    /**
     * The extra miner nonce typically used for pool based mining
     */
    public get minerNonce (): number {
        if (!this.minerTransaction.poolNonce) {
            return 0;
        } else if (typeof this.minerTransaction.poolNonce === 'number') {
            return this.minerTransaction.poolNonce;
        } else {
            return (this.minerTransaction.poolNonce as BigInteger.BigInteger).toJSNumber();
        }
    }

    public set minerNonce (nonce: number) {
        this.minerTransaction.poolNonce = nonce;
    }

    /**
     * Whether the given hash meets the difficulty specified
     * @param hash the block POW hash
     * @param difficulty the target difficulty
     */
    public static hashMeetsDifficulty (hash: string, difficulty: number): boolean {
        const reversedHash = hash.match(/[0-9a-f]{2}/gi)?.reverse().join('');

        if (!reversedHash) {
            throw new Error('Cannot read hash');
        }

        const hashDiff = BigInteger(reversedHash, 16).multiply(difficulty);

        const maxValue = BigInteger('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 16);

        return (hashDiff.compare(maxValue) === -1);
    }

    /**
     * Creates a new block template instance using the supplied daemon response
     * @param response the daemon response to the get_blocktemplate call
     */
    public static from (response: Interfaces.DaemonBlockTemplateResponse): BlockTemplate {
        const result = new BlockTemplate();

        result.m_blockTemplate = Buffer.from(response.blocktemplate, 'hex');
        result.m_difficulty = response.difficulty;
        result.m_reservedOffset = response.reservedOffset;
        result.m_height = response.height;
        result.m_block = Block.from(response.blocktemplate);

        return result;
    }

    protected m_blockTemplate: Buffer = Buffer.alloc(0);
    protected m_difficulty = 1;
    protected m_height = 0;
    protected m_reservedOffset = 0;
    protected m_block: Block = new Block();
    protected m_extraNonceOffset = 0;
    protected m_extraNonceSafeLength = 0;

    /**
     * Converts a block into a v1 hashing block typically used by miners during mining operations
     * this method actually creates a merged mining block that merge mines itself
     * @param block the block to convert for miner hashing
     * @returns the mining block
     */
    public convert (block?: Block): Block {
        const originalBlock = block || this.m_block;

        if (originalBlock.majorVersion >= this.activateParentBlockVersion) {
        /* If we support merged mining, then we can reduce the size of
               the block blob sent to the miners by crafting a new block
               with the blocktemplate provided by the daemon into a new
               block that contains the original block information as a MM
               tag in the miner transaction */
            const newBlock = new Block();
            newBlock.majorVersion = 1;
            newBlock.minorVersion = 0;
            newBlock.timestamp = originalBlock.timestamp;
            newBlock.previousBlockHash = originalBlock.previousBlockHash;
            newBlock.nonce = originalBlock.nonce;

            newBlock.minerTransaction.addMergedMining(0, originalBlock.merkleRoot);

            return newBlock;
        } else {
            return originalBlock;
        }
    }

    /**
     * Constructs a new "final" block that can be submitted to the network using
     * an original the original block in the block template and the nonce value found
     * @param nonce the nonce value for the block
     * @param [branch] the blockchain branch containing the merged mining information
     * @returns the block that can be submitted to the network
     */
    public construct (nonce: number, branch?: string): Block {
        const block: Block = this.m_block;

        block.nonce = nonce;

        if (block.majorVersion >= this.activateParentBlockVersion) {
        /* First we create the new parent block */
            const newBlock = this.convert(block);

            /* Then assign the nonce to it */
            newBlock.nonce = nonce;

            /* Then we merge the two blocks together */
            block.timestamp = newBlock.timestamp;
            block.parentBlock.majorVersion = newBlock.majorVersion;
            block.parentBlock.minorVersion = newBlock.minorVersion;
            block.parentBlock.previousBlockHash = newBlock.previousBlockHash;
            block.parentBlock.minerTransaction = newBlock.minerTransaction;
            block.parentBlock.transactionCount = newBlock.transactions.length + 1; // +1 for the miner transaction
            block.parentBlock.baseTransactionBranch = newBlock.baseTransactionBranch;

            /* We only add this if it actually exists */
            if (branch) {
                block.parentBlock.blockchainBranch = [branch];
            }
        }

        return block;
    }
}
