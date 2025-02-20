// Copyright (c) 2018-2020, The ninjacoin Developers
//
// Please see the included LICENSE file for more information.

import { AddressPrefix } from './AddressPrefix';
import { Base58 } from '@ninjacoin/base58';
import { Common } from './Common';
import { Config } from './Config';
import { ED25519, NinjaCoinCrypto } from './Types';
import { Mnemonics } from '@ninjacoin/mnemonics';
import { Reader, Writer } from '@ninjacoin/bytestream';

/** @ignore */
interface Cache {
    addressPrefix: string;
    address: string;
}

/** @ignore */
export enum SIZES {
    KEY = 32,
    CHECKSUM = 4,
}

/**
 * Represents a ninjacoin address
 */
export class Address {
    /**
     * The Base58 encoded address
     */
    public async address (): Promise<string> {
        return this.toString();
    }

    /**
     * The address index number [0=primary]
     */
    public get subwalletIndex (): number {
        return this.m_subwalletIndex;
    }

    /**
     * The seed phrase for the address if available
     */
    public get seed (): string | undefined {
        return this.m_seed;
    }

    /**
     * The mnemonic phrase for the address if available
     */
    public get mnemonic (): string | undefined {
        return (this.m_seed) ? Mnemonics.encode(this.m_seed) : undefined;
    }

    /**
     * The payment Id of the address if one exists
     */
    public get paymentId (): string {
        return Buffer.from(this.m_paymentId || '', 'hex').toString().toLowerCase();
    }

    public set paymentId (paymentId: string) {
        if (!Common.isHex64(paymentId)) {
            throw new Error('Invalid payment ID supplied');
        }

        this.m_paymentId = Buffer.from(paymentId).toString('hex');
    }

    /**
     * The address prefix
     */
    public get prefix (): AddressPrefix {
        return this.m_prefix;
    }

    public set prefix (addressPrefix: AddressPrefix) {
        this.m_prefix = addressPrefix;
    }

    /**
     * The address spend keys
     */
    public get spend (): ED25519.KeyPair {
        return this.m_keys.spend;
    }

    public set spend (keys: ED25519.KeyPair) {
        this.m_keys.spend = keys;
    }

    /**
     * The address view keys
     */
    public get view (): ED25519.KeyPair {
        return this.m_keys.view;
    }

    public set view (keys: ED25519.KeyPair) {
        this.m_keys.view = keys;
    }

    /**
     * Creates a new address object from a Base58 address
     * @param address the public address to decode
     * @param [prefix] the address prefix
     * @returns a new address object
     */
    public static async fromAddress (address: string, prefix?: AddressPrefix | number): Promise<Address> {
        if (typeof prefix === 'number') {
            prefix = new AddressPrefix(prefix);
        } else if (typeof prefix === 'undefined') {
            prefix = new AddressPrefix();
        }

        const decodedAddress = Base58.decode(address);

        const reader = new Reader(decodedAddress);

        const decodedPrefix = reader.bytes(prefix.size).toString('hex');

        if (decodedPrefix !== prefix.hex) {
            throw new Error('Invalid address prefix');
        }

        let paymentId = '';

        if (reader.unreadBytes > ((SIZES.KEY * 2) + SIZES.CHECKSUM)) {
            paymentId = reader.hex(SIZES.KEY * 2);
        }

        const publicSpend = reader.hash();
        const publicView = reader.hash();
        const expectedChecksum = reader.bytes(SIZES.CHECKSUM).toString('hex');

        const checksum = (new Reader(
            await NinjaCoinCrypto.cn_fast_hash(decodedPrefix + paymentId + publicSpend + publicView)
        )).bytes(SIZES.CHECKSUM).toString('hex');

        if (expectedChecksum !== checksum) {
            throw new Error('Could not parse address: checksum mismatch');
        }

        const result = new Address();

        result.m_paymentId = paymentId;

        result.m_keys = await ED25519.Keys.from(
            await ED25519.KeyPair.from(publicSpend),
            await ED25519.KeyPair.from(publicView)
        );

        return result;
    }

    /**
     * Creates a new address object using the supplied public keys
     * @param publicSpendKey the public spend key
     * @param publicViewKey the public view key
     * @param [paymentId] the payment ID
     * @param [prefix] the address prefix
     * @returns a new address object
     */
    public static async fromPublicKeys (
        publicSpendKey: string,
        publicViewKey: string,
        paymentId?: string,
        prefix?: AddressPrefix | number
    ): Promise<Address> {
        if (typeof prefix === 'number') {
            prefix = new AddressPrefix(prefix);
        }

        const address = new Address();

        if (prefix) {
            address.prefix = prefix;
        }

        if (paymentId) {
            address.paymentId = paymentId;
        }

        address.m_keys = await ED25519.Keys.from(
            await ED25519.KeyPair.from(publicSpendKey),
            await ED25519.KeyPair.from(publicViewKey)
        );

        return address;
    }

    /**
     * Creates a new address object (view only) using the supplied keys
     * @param publicSpendKey the public spend key
     * @param privateViewKey the private view key
     * @param [paymentId] the payment ID
     * @param [prefix] the address prefix
     * @returns a new address object
     */
    public static async fromViewOnlyKeys (
        publicSpendKey: string,
        privateViewKey: string,
        paymentId?: string,
        prefix?: AddressPrefix | number
    ): Promise<Address> {
        if (typeof prefix === 'number') {
            prefix = new AddressPrefix(prefix);
        }

        const address = new Address();

        if (prefix) {
            address.prefix = prefix;
        }

        if (paymentId) {
            address.paymentId = paymentId;
        }

        address.m_keys = await ED25519.Keys.from(
            await ED25519.KeyPair.from(publicSpendKey),
            await ED25519.KeyPair.from(undefined, privateViewKey)
        );

        return address;
    }

    /**
     * Creates a new address object using the supplied private keys
     * @param privateSpendKey the private spend key
     * @param privateViewKey the private view key
     * @param [prefix] the address prefix
     * @returns a new address object
     */
    public static async fromKeys (
        privateSpendKey: string,
        privateViewKey: string,
        prefix?: AddressPrefix | number
    ): Promise<Address> {
        if (typeof prefix === 'number') {
            prefix = new AddressPrefix(prefix);
        }

        const address = new Address();

        if (prefix) {
            address.prefix = prefix;
        }

        address.m_keys = await ED25519.Keys.from(
            await ED25519.KeyPair.from(undefined, privateSpendKey),
            await ED25519.KeyPair.from(undefined, privateViewKey)
        );

        const derivedViewKey = await ED25519.KeyPair.from(undefined, privateSpendKey, undefined, 1);

        if (derivedViewKey.privateKey === privateViewKey) {
            address.m_seed = privateSpendKey;
        }

        return address;
    }

    /**
     * Creates a new address object from a mnemonic phrase
     * @param mnemonic the wallet mnemonic phrase
     * @param [language] the language of the mnemonic phrase
     * @param [prefix] the address prefix
     * @returns a new address object
     */
    public static async fromMnemonic (
        mnemonic: string,
        language?: string,
        prefix?: AddressPrefix | number
    ): Promise<Address> {
        const seed = Mnemonics.decode(mnemonic);

        return Address.fromSeed(seed, language, prefix);
    }

    /**
     * Creates a new address object from a seed
     * @param seed the wallet seed
     * @param [language] the language of the mnemonic phrase
     * @param [prefix] the address prefix
     * @returns a new address object
     */
    public static async fromSeed (seed: string, language?: string, prefix?: AddressPrefix | number): Promise<Address> {
        if (typeof prefix === 'number') {
            prefix = new AddressPrefix(prefix);
        }

        if (!Common.isHex64(seed)) {
            seed = await NinjaCoinCrypto.cn_fast_hash(seed);
        }

        const address = new Address();

        address.m_seed = seed;

        address.m_language = language || 'english';

        if (prefix) {
            address.prefix = prefix;
        }

        address.m_keys = await ED25519.Keys.from(
            await ED25519.KeyPair.from(undefined, seed),
            await ED25519.KeyPair.from(undefined, seed, undefined, 1));

        return address;
    }

    /**
     * Creates a new address object from entropy (new address)
     * @param [entropy] data to use for entropy to feed to the underlying random generation function
     * @param [language] the language of the mnemonic phrase
     * @param [prefix] the address prefix
     * @returns a new address object
     */
    public static async fromEntropy (
        entropy?: string,
        language?: string,
        prefix?: AddressPrefix | number
    ): Promise<Address> {
        const seed = await Address.generateSeed(entropy);

        return Address.fromSeed(seed, language, prefix);
    }

    /**
     * Generates a new seed from entropy
     * @param [entropy] data to use for entropy to feed to the underlying random generation function
     * @param [iterations] the number of iterations to run the hashing function when generating the seed
     * @returns a new randomly created seed
     */
    public static async generateSeed (entropy?: string, iterations?: number): Promise<string> {
        const random = await ED25519.KeyPair.from(undefined, undefined, entropy, iterations);

        return random.privateKey;
    }

    /**
     * Generates a new subwallet address object using the supplied parameters
     * @param privateSpendKey the private spend key
     * @param subwalletIndex the subwallet index number
     * @param [language] the language of the mnemonic phrase
     * @param [prefix] the address prefix
     * @returns a new address object
     */
    public static async generateSubwallet (
        privateSpendKey: string,
        subwalletIndex: number,
        language?: string,
        prefix?: AddressPrefix | number
    ): Promise<Address> {
        if (typeof prefix === 'number') {
            prefix = new AddressPrefix(prefix);
        }

        if (!await NinjaCoinCrypto.checkScalar(privateSpendKey)) {
            throw new Error('Invalid private spend key supplied');
        }

        subwalletIndex = Math.abs(subwalletIndex);

        if (subwalletIndex === 0) {
            return Address.fromSeed(privateSpendKey, language, prefix);
        }

        const address = new Address();

        address.m_subwalletIndex = subwalletIndex;

        if (prefix) {
            address.prefix = prefix;
        }

        const view = await ED25519.KeyPair.from(undefined, privateSpendKey, undefined, 1);

        const spend = await NinjaCoinCrypto.generateDeterministicSubwalletKeys(privateSpendKey, subwalletIndex);

        address.m_keys = await ED25519.Keys.from(
            await ED25519.KeyPair.from(spend.public_key, spend.private_key), view);

        return address;
    }

    /**
     * Encodes a raw address (hex) into Base58 notation
     * @param rawAddress the raw address in hexadecimal form
     * @retursn the Base58 representation of the address
     */
    public static encodeRaw (rawAddress: string): string {
        return Base58.encode(rawAddress);
    }

    protected m_paymentId?: string;
    protected m_seed?: string;
    protected m_keys: ED25519.Keys = new ED25519.Keys();
    protected m_language = 'english';
    protected m_subwalletIndex = 0;
    private m_prefix: AddressPrefix = new AddressPrefix(Config.addressPrefix);
    private m_cached: Cache = { addressPrefix: '', address: '' };

    /**
     * Returns the Base58 encoded address
     * @returns Base58 encoded address
     */
    public async toString (): Promise<string> {
        const writer = new Writer();

        writer.hex(this.prefix.hex);

        if (this.m_paymentId) {
            writer.hex(this.m_paymentId);
        }

        writer.hash(this.m_keys.spend.publicKey);

        writer.hash(this.m_keys.view.publicKey);

        if (this.m_cached.addressPrefix === writer.blob && this.m_cached.address.length !== 0) {
            return Base58.encode(this.m_cached.address);
        }

        const checksum = (await NinjaCoinCrypto.cn_fast_hash(writer.blob))
            .slice(0, 8);

        this.m_cached.addressPrefix = writer.blob;

        writer.hex(checksum);

        this.m_cached.address = writer.blob;

        return Base58.encode(writer.blob);
    }
}
