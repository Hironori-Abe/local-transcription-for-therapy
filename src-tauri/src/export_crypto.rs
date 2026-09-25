use aes::Aes256;
use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(test)]
use cbc::cipher::BlockDecryptMut;
use cbc::cipher::{block_padding::NoPadding, BlockEncryptMut, KeyIvInit};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha512};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use zip2::write::SimpleFileOptions;
use zip2::{AesMode, CompressionMethod, ZipWriter};

const SPIN_COUNT: u32 = 100_000;
const SEGMENT_SIZE: usize = 4096;
const BLOCK_SIZE: usize = 16;
const PASSWORD_KEY_VERIFIER_INPUT: [u8; 8] = [
    0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79,
];
const PASSWORD_KEY_VERIFIER_HASH: [u8; 8] = [
    0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e,
];
const PASSWORD_KEY_ENCRYPTED_KEY: [u8; 8] = [
    0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6,
];
const DATA_INTEGRITY_KEY: [u8; 8] = [
    0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6,
];
const DATA_INTEGRITY_VALUE: [u8; 8] = [
    0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33,
];

const DATASPACES_VERSION: &[u8] = b"\x3c\x00\x00\x00\x4d\x00\x69\x00\x63\x00\x72\x00\x6f\x00\x73\x00\x6f\x00\x66\x00\x74\x00\x2e\x00\x43\x00\x6f\x00\x6e\x00\x74\x00\x61\x00\x69\x00\x6e\x00\x65\x00\x72\x00\x2e\x00\x44\x00\x61\x00\x74\x00\x61\x00\x53\x00\x70\x00\x61\x00\x63\x00\x65\x00\x73\x00\x01\x00\x00\x00\x01\x00\x00\x00\x01\x00\x00\x00";
const DATASPACES_PRIMARY: &[u8] = b"\x58\x00\x00\x00\x01\x00\x00\x00\x4c\x00\x00\x00\x7b\x00\x46\x00\x46\x00\x39\x00\x41\x00\x33\x00\x46\x00\x30\x00\x33\x00\x2d\x00\x35\x00\x36\x00\x45\x00\x46\x00\x2d\x00\x34\x00\x36\x00\x31\x00\x33\x00\x2d\x00\x42\x00\x44\x00\x44\x00\x35\x00\x2d\x00\x35\x00\x41\x00\x34\x00\x31\x00\x43\x00\x31\x00\x44\x00\x30\x00\x37\x00\x32\x00\x34\x00\x36\x00\x7d\x00\x4e\x00\x00\x00\x4d\x00\x69\x00\x63\x00\x72\x00\x6f\x00\x73\x00\x6f\x00\x66\x00\x74\x00\x2e\x00\x43\x00\x6f\x00\x6e\x00\x74\x00\x61\x00\x69\x00\x6e\x00\x65\x00\x72\x00\x2e\x00\x45\x00\x6e\x00\x63\x00\x72\x00\x79\x00\x70\x00\x74\x00\x69\x00\x6f\x00\x6e\x00\x54\x00\x72\x00\x61\x00\x6e\x00\x73\x00\x66\x00\x6f\x00\x72\x00\x6d\x00\x00\x00\x01\x00\x00\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x04\x00\x00\x00";
const DATASPACES_MAP: &[u8] = b"\x08\x00\x00\x00\x01\x00\x00\x00\x68\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x20\x00\x00\x00\x45\x00\x6e\x00\x63\x00\x72\x00\x79\x00\x70\x00\x74\x00\x65\x00\x64\x00\x50\x00\x61\x00\x63\x00\x6b\x00\x61\x00\x67\x00\x65\x00\x32\x00\x00\x00\x53\x00\x74\x00\x72\x00\x6f\x00\x6e\x00\x67\x00\x45\x00\x6e\x00\x63\x00\x72\x00\x79\x00\x70\x00\x74\x00\x69\x00\x6f\x00\x6e\x00\x44\x00\x61\x00\x74\x00\x61\x00\x53\x00\x70\x00\x61\x00\x63\x00\x65\x00\x00\x00";
const DATASPACES_STRONG_ENCRYPTION: &[u8] = b"\x08\x00\x00\x00\x01\x00\x00\x00\x32\x00\x00\x00\x53\x00\x74\x00\x72\x00\x6f\x00\x6e\x00\x67\x00\x45\x00\x6e\x00\x63\x00\x72\x00\x79\x00\x70\x00\x74\x00\x69\x00\x6f\x00\x6e\x00\x54\x00\x72\x00\x61\x00\x6e\x00\x73\x00\x66\x00\x6f\x00\x72\x00\x6d\x00\x00\x00";

type HmacSha512 = Hmac<Sha512>;
type Aes256CbcEncryptor = cbc::Encryptor<Aes256>;
#[cfg(test)]
type Aes256CbcDecryptor = cbc::Decryptor<Aes256>;

struct TempOutput {
    path: PathBuf,
    keep: bool,
}

impl TempOutput {
    fn commit(mut self, destination: &Path) -> Result<(), String> {
        replace_file(&self.path, destination)?;
        self.keep = true;
        Ok(())
    }
}

impl Drop for TempOutput {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_file(&self.path);
        }
    }
}

struct AgilePackage {
    encryption_info: Vec<u8>,
    encrypted_package: Vec<u8>,
    #[cfg(test)]
    test_material: AgileTestMaterial,
}

#[cfg(test)]
struct AgileTestMaterial {
    password_salt: [u8; 16],
    encrypted_verifier_hash_input: Vec<u8>,
    encrypted_verifier_hash_value: Vec<u8>,
    encrypted_key_value: Vec<u8>,
    secret_key: [u8; 32],
    data_salt: [u8; 16],
    hmac_key: [u8; 64],
    encrypted_hmac_key: Vec<u8>,
    encrypted_hmac_value: Vec<u8>,
}

/// OOXML（DOCX / XLSX）を ECMA-376 Agile Encryption でその場で暗号化する。
pub fn encrypt_ooxml_in_place(path: &Path, password: &str) -> Result<(), String> {
    if password.is_empty() {
        return Err("パスワードが空です。パスワードを入力してから保存してください。".to_string());
    }

    let mut input = File::open(path)
        .map_err(|e| format!("暗号化する Office ファイルを開けませんでした。保存先を確認してもう一度保存してください: {e}"))?;
    let mut plaintext = Vec::new();
    input
        .read_to_end(&mut plaintext)
        .map_err(|e| format!("暗号化する Office ファイルを読み込めませんでした。もう一度保存してください: {e}"))?;
    // Windows では開いたままのファイルを置き換えられないため、読み終えたら閉じる
    drop(input);
    validate_ooxml(&plaintext)?;

    let encrypted = build_agile_package(&plaintext, password)?;
    let (temporary, file) = create_temp_output(path)?;
    write_compound_file(file, &encrypted.encryption_info, &encrypted.encrypted_package)?;
    temporary.commit(path)
}

/// 1 ファイルを WinZip AES-256 (AE-2) + Deflate の ZIP に入れる。
pub fn write_aes_zip(
    input: &Path,
    output_zip: &Path,
    arcname: &str,
    password: &str,
) -> Result<(), String> {
    if password.is_empty() {
        return Err("パスワードが空です。パスワードを入力してから保存してください。".to_string());
    }
    if arcname.is_empty() {
        return Err("ZIP 内のファイル名が空です。保存するファイル名を確認してください。".to_string());
    }

    let source = File::open(input)
        .map_err(|e| format!("ZIP に入れる一時ファイルを開けませんでした。もう一度保存してください: {e}"))?;
    let (temporary, file) = create_temp_output(output_zip)?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .with_aes_encryption(AesMode::Aes256, password);
    archive
        .start_file(arcname, options)
        .map_err(|e| format!("暗号化 ZIP の作成を開始できませんでした。保存先を確認してもう一度保存してください: {e}"))?;
    let mut source = source;
    io::copy(&mut source, &mut archive)
        .map_err(|e| format!("暗号化 ZIP へ書き込めませんでした。ディスクの空き容量を確認してもう一度保存してください: {e}"))?;
    let file = archive
        .finish()
        .map_err(|e| format!("暗号化 ZIP を完成できませんでした。もう一度保存してください: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("暗号化 ZIP をディスクへ書き込めませんでした。もう一度保存してください: {e}"))?;
    drop(file);
    temporary.commit(output_zip)
}

fn validate_ooxml(data: &[u8]) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(data)).map_err(|_| {
        "暗号化対象が有効な OOXML ファイルではありません。未暗号化の DOCX / XLSX を選択してください。".to_string()
    })?;
    let mut types = String::new();
    let mut entry = archive.by_name("[Content_Types].xml").map_err(|_| {
        "暗号化対象が有効な OOXML ファイルではありません。未暗号化の DOCX / XLSX を選択してください。".to_string()
    })?;
    entry.read_to_string(&mut types).map_err(|_| {
        "[Content_Types].xml を読み込めませんでした。元ファイルが壊れていないか確認してください。".to_string()
    })?;
    if !types.contains("http://schemas.openxmlformats.org/package/2006/content-types") {
        return Err("暗号化対象が有効な OOXML ファイルではありません。未暗号化の DOCX / XLSX を選択してください。".to_string());
    }
    Ok(())
}

fn build_agile_package(plaintext: &[u8], password: &str) -> Result<AgilePackage, String> {
    let mut password_salt = [0u8; 16];
    getrandom::getrandom(&mut password_salt)
        .map_err(|e| format!("乱数を生成できませんでした（OS の乱数機能を利用できません）。もう一度保存してください: {e}"))?;
    let password_hash = derive_iterated_password_hash(password, &password_salt);
    let key1 = derive_encryption_key(&password_hash, &PASSWORD_KEY_VERIFIER_INPUT);
    let key2 = derive_encryption_key(&password_hash, &PASSWORD_KEY_VERIFIER_HASH);
    let key3 = derive_encryption_key(&password_hash, &PASSWORD_KEY_ENCRYPTED_KEY);

    let mut verifier = [0u8; 16];
    getrandom::getrandom(&mut verifier)
        .map_err(|e| format!("乱数を生成できませんでした（OS の乱数機能を利用できません）。もう一度保存してください: {e}"))?;
    let encrypted_verifier_hash_input = encrypt_cbc_no_padding(&verifier, &key1, &password_salt)?;
    let verifier_hash = Sha512::digest(verifier);
    let encrypted_verifier_hash_value =
        encrypt_cbc_no_padding(&verifier_hash, &key2, &password_salt)?;

    let mut secret_key = [0x36u8; 32];
    getrandom::getrandom(&mut secret_key[..16])
        .map_err(|e| format!("乱数を生成できませんでした（OS の乱数機能を利用できません）。もう一度保存してください: {e}"))?;
    let encrypted_key_value = encrypt_cbc_no_padding(&secret_key, &key3, &password_salt)?;

    let mut data_salt = [0u8; 16];
    getrandom::getrandom(&mut data_salt)
        .map_err(|e| format!("乱数を生成できませんでした（OS の乱数機能を利用できません）。もう一度保存してください: {e}"))?;
    let encrypted_package = encrypt_payload(plaintext, &secret_key, &data_salt)?;

    let mut hmac_key = [0u8; 64];
    getrandom::getrandom(&mut hmac_key)
        .map_err(|e| format!("乱数を生成できませんでした（OS の乱数機能を利用できません）。もう一度保存してください: {e}"))?;
    let encrypted_hmac_key = encrypt_cbc_no_padding(
        &hmac_key,
        &secret_key,
        &derive_iv(&data_salt, &DATA_INTEGRITY_KEY),
    )?;
    let mut hmac = <HmacSha512 as Mac>::new_from_slice(&hmac_key)
        .map_err(|_| "完全性検証用の鍵を準備できませんでした。もう一度保存してください。".to_string())?;
    hmac.update(&encrypted_package);
    let hmac_value = hmac.finalize().into_bytes();
    let encrypted_hmac_value = encrypt_cbc_no_padding(
        &hmac_value,
        &secret_key,
        &derive_iv(&data_salt, &DATA_INTEGRITY_VALUE),
    )?;

    let b64 = |value: &[u8]| STANDARD.encode(value);
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<encryption xmlns=\"http://schemas.microsoft.com/office/2006/encryption\" xmlns:p=\"http://schemas.microsoft.com/office/2006/keyEncryptor/password\" xmlns:c=\"http://schemas.microsoft.com/office/2006/keyEncryptor/certificate\">\n\
    <keyData saltSize=\"16\" blockSize=\"16\" keyBits=\"256\" hashSize=\"64\" cipherAlgorithm=\"AES\" cipherChaining=\"ChainingModeCBC\" hashAlgorithm=\"SHA512\" saltValue=\"{}\" />\n\
    <dataIntegrity encryptedHmacKey=\"{}\" encryptedHmacValue=\"{}\" />\n\
    <keyEncryptors>\n\
        <keyEncryptor uri=\"http://schemas.microsoft.com/office/2006/keyEncryptor/password\">\n\
            <p:encryptedKey spinCount=\"{}\" saltSize=\"16\" blockSize=\"16\" keyBits=\"256\" hashSize=\"64\" cipherAlgorithm=\"AES\" cipherChaining=\"ChainingModeCBC\" hashAlgorithm=\"SHA512\" saltValue=\"{}\" encryptedVerifierHashInput=\"{}\" encryptedVerifierHashValue=\"{}\" encryptedKeyValue=\"{}\" />\n\
        </keyEncryptor>\n\
    </keyEncryptors>\n\
</encryption>\n",
        b64(&data_salt),
        b64(&encrypted_hmac_key),
        b64(&encrypted_hmac_value),
        SPIN_COUNT,
        b64(&password_salt),
        b64(&encrypted_verifier_hash_input),
        b64(&encrypted_verifier_hash_value),
        b64(&encrypted_key_value),
    );
    let mut encryption_info = vec![0x04, 0x00, 0x04, 0x00, 0x40, 0x00, 0x00, 0x00];
    encryption_info.extend_from_slice(xml.as_bytes());

    Ok(AgilePackage {
        encryption_info,
        encrypted_package,
        #[cfg(test)]
        test_material: AgileTestMaterial {
            password_salt,
            encrypted_verifier_hash_input,
            encrypted_verifier_hash_value,
            encrypted_key_value,
            secret_key,
            data_salt,
            hmac_key,
            encrypted_hmac_key,
            encrypted_hmac_value,
        },
    })
}

fn derive_iterated_password_hash(password: &str, salt: &[u8; 16]) -> Vec<u8> {
    let password_utf16: Vec<u8> = password
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    let mut hasher = Sha512::new();
    hasher.update(salt);
    hasher.update(password_utf16);
    let mut hash = hasher.finalize().to_vec();
    for spin in 0..SPIN_COUNT {
        let mut hasher = Sha512::new();
        hasher.update(spin.to_le_bytes());
        hasher.update(&hash);
        hash = hasher.finalize().to_vec();
    }
    hash
}

fn derive_encryption_key(password_hash: &[u8], block_key: &[u8]) -> [u8; 32] {
    let mut hasher = Sha512::new();
    hasher.update(password_hash);
    hasher.update(block_key);
    let digest = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest[..32]);
    key
}

fn derive_iv(salt: &[u8; 16], block_key: &[u8; 8]) -> [u8; 16] {
    let mut hasher = Sha512::new();
    hasher.update(salt);
    hasher.update(block_key);
    let digest = hasher.finalize();
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&digest[..16]);
    iv
}

fn encrypt_payload(plaintext: &[u8], key: &[u8; 32], salt: &[u8; 16]) -> Result<Vec<u8>, String> {
    let size = u64::try_from(plaintext.len())
        .map_err(|_| "OOXML ファイルが大きすぎるため暗号化できません。".to_string())?;
    let mut encrypted = Vec::with_capacity(8 + plaintext.len() + SEGMENT_SIZE);
    encrypted.extend_from_slice(&size.to_le_bytes());
    for (index, segment) in plaintext.chunks(SEGMENT_SIZE).enumerate() {
        let index = u32::try_from(index)
            .map_err(|_| "OOXML ファイルが大きすぎるため暗号化できません。".to_string())?;
        let iv = derive_segment_iv(salt, index);
        let mut padded = segment.to_vec();
        padded.resize(padded.len().div_ceil(BLOCK_SIZE) * BLOCK_SIZE, 0);
        encrypted.extend_from_slice(&encrypt_cbc_no_padding(&padded, key, &iv)?);
    }
    Ok(encrypted)
}

fn derive_segment_iv(salt: &[u8; 16], index: u32) -> [u8; 16] {
    let mut hasher = Sha512::new();
    hasher.update(salt);
    hasher.update(index.to_le_bytes());
    let digest = hasher.finalize();
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&digest[..16]);
    iv
}

fn encrypt_cbc_no_padding(data: &[u8], key: &[u8; 32], iv: &[u8; 16]) -> Result<Vec<u8>, String> {
    if data.len() % BLOCK_SIZE != 0 {
        return Err("内部エラー: AES の入力長がブロック長の倍数ではありません。".to_string());
    }
    let cipher = Aes256CbcEncryptor::new_from_slices(key, iv)
        .map_err(|_| "内部エラー: AES 暗号化の準備に失敗しました。".to_string())?;
    Ok(cipher.encrypt_padded_vec_mut::<NoPadding>(data))
}

#[cfg(test)]
fn decrypt_cbc_no_padding(data: &[u8], key: &[u8; 32], iv: &[u8; 16]) -> Result<Vec<u8>, String> {
    if data.len() % BLOCK_SIZE != 0 {
        return Err("内部エラー: AES の入力長がブロック長の倍数ではありません。".to_string());
    }
    let cipher = Aes256CbcDecryptor::new_from_slices(key, iv)
        .map_err(|_| "内部エラー: AES 復号の準備に失敗しました。".to_string())?;
    cipher
        .decrypt_padded_vec_mut::<NoPadding>(data)
        .map_err(|_| "内部エラー: AES 復号に失敗しました。".to_string())
}

fn write_compound_file(file: File, encryption_info: &[u8], encrypted_package: &[u8]) -> Result<(), String> {
    let mut compound = cfb::CompoundFile::create_with_version(cfb::Version::V3, file)
        .map_err(|e| format!("暗号化 Office ファイルの作成を開始できませんでした。もう一度保存してください: {e}"))?;
    write_cfb_stream(&mut compound, "/EncryptionInfo", encryption_info)?;
    write_cfb_stream(&mut compound, "/EncryptedPackage", encrypted_package)?;
    compound
        .create_storage_all("/\x06DataSpaces")
        .map_err(|e| format!("Office 暗号化情報の領域を作成できませんでした。もう一度保存してください: {e}"))?;
    write_cfb_stream(&mut compound, "/\x06DataSpaces/Version", DATASPACES_VERSION)?;
    write_cfb_stream(&mut compound, "/\x06DataSpaces/DataSpaceMap", DATASPACES_MAP)?;
    compound
        .create_storage_all("/\x06DataSpaces/DataSpaceInfo")
        .map_err(|e| format!("Office DataSpaces の領域を作成できませんでした。もう一度保存してください: {e}"))?;
    write_cfb_stream(
        &mut compound,
        "/\x06DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace",
        DATASPACES_STRONG_ENCRYPTION,
    )?;
    compound
        .create_storage_all("/\x06DataSpaces/TransformInfo/StrongEncryptionTransform")
        .map_err(|e| format!("Office 暗号化変換情報の領域を作成できませんでした。もう一度保存してください: {e}"))?;
    write_cfb_stream(
        &mut compound,
        "/\x06DataSpaces/TransformInfo/StrongEncryptionTransform/\x06Primary",
        DATASPACES_PRIMARY,
    )?;
    compound
        .flush()
        .map_err(|e| format!("暗号化 Office ファイルを書き込めませんでした。もう一度保存してください: {e}"))?;
    let file = compound.into_inner();
    file.sync_all()
        .map_err(|e| format!("暗号化 Office ファイルをディスクへ書き込めませんでした。もう一度保存してください: {e}"))
}

fn write_cfb_stream(
    compound: &mut cfb::CompoundFile<File>,
    path: &str,
    data: &[u8],
) -> Result<(), String> {
    let mut stream = compound.create_stream(path).map_err(|e| {
        format!("Office ファイル内のデータ領域を作成できませんでした。もう一度保存してください: {e}")
    })?;
    stream.write_all(data).map_err(|e| {
        format!("Office ファイル内のデータを書き込めませんでした。ディスクの空き容量を確認してください: {e}")
    })
}

fn create_temp_output(destination: &Path) -> Result<(TempOutput, File), String> {
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut random = [0u8; 16];
    for _ in 0..8 {
        getrandom::getrandom(&mut random)
            .map_err(|e| format!("一時ファイル名の乱数を生成できませんでした（OS の乱数機能を利用できません）。もう一度保存してください: {e}"))?;
        let name = random.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let path = parent.join(format!(".lott-export-{name}.tmp"));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(file) => return Ok((TempOutput { path, keep: false }, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("保存先フォルダに一時ファイルを作成できませんでした。保存先の書き込み権限を確認してください: {error}"));
            }
        }
    }
    Err("一時ファイル名が重複したため保存できませんでした。もう一度保存してください。".to_string())
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            return Err(format!("暗号化したファイルで元のファイルを置き換えられませんでした。ファイルを開いているアプリを閉じてから保存してください: {}", io::Error::last_os_error()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, destination)
            .map_err(|e| format!("暗号化したファイルで元のファイルを置き換えられませんでした。ファイルを開いているアプリを閉じてから保存してください: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::{write::FileOptions, CompressionMethod, ZipWriter};
    use zip2::ZipArchive;

    const TEST_PASSWORD: &str = "correct horse battery staple";

    struct TestPath(PathBuf);

    impl TestPath {
        fn new(label: &str) -> Self {
            let mut random = [0u8; 8];
            getrandom::getrandom(&mut random).expect("OS random source available");
            let suffix = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
            Self(std::env::temp_dir().join(format!("lott-{label}-{suffix}")))
        }
    }

    impl Drop for TestPath {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).expect("create OOXML zip");
        let mut archive = ZipWriter::new(file);
        let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, data) in entries {
            archive.start_file(*name, options).expect("start OOXML entry");
            archive.write_all(data).expect("write OOXML entry");
        }
        archive.finish().expect("finish OOXML zip");
    }

    fn decrypt_payload_for_test(
        encrypted: &[u8],
        key: &[u8; 32],
        salt: &[u8; 16],
    ) -> Vec<u8> {
        let size = u64::from_le_bytes(encrypted[..8].try_into().expect("package size")) as usize;
        let mut plain = Vec::with_capacity(size);
        let mut offset = 8;
        for (index, len) in (0..size).step_by(SEGMENT_SIZE).enumerate() {
            let segment_len = (size - len).min(SEGMENT_SIZE);
            let cipher_len = segment_len.div_ceil(BLOCK_SIZE) * BLOCK_SIZE;
            let iv = derive_segment_iv(salt, index as u32);
            let chunk = decrypt_cbc_no_padding(&encrypted[offset..offset + cipher_len], key, &iv)
                .expect("decrypt payload segment");
            plain.extend_from_slice(&chunk[..segment_len]);
            offset += cipher_len;
        }
        assert_eq!(offset, encrypted.len());
        plain
    }

    #[test]
    fn aes_zip_reads_with_correct_password_and_rejects_wrong_password() {
        let dir = TestPath::new("aes-zip");
        fs::create_dir_all(&dir.0).expect("create test directory");
        let input = dir.0.join("input.json");
        let output = dir.0.join("result.zip");
        let expected = br#"{"text":"private transcript"}"#;
        fs::write(&input, expected).expect("write input");

        write_aes_zip(&input, &output, "result.json", TEST_PASSWORD).expect("encrypt ZIP");

        let mut archive = ZipArchive::new(File::open(&output).expect("open encrypted ZIP"))
            .expect("read encrypted ZIP");
        let mut entry = archive
            .by_name_decrypt("result.json", TEST_PASSWORD.as_bytes())
            .expect("open encrypted entry");
        let mut actual = Vec::new();
        entry.read_to_end(&mut actual).expect("decrypt entry");
        assert_eq!(actual, expected);

        let mut archive = ZipArchive::new(File::open(&output).expect("reopen encrypted ZIP"))
            .expect("read encrypted ZIP");
        let result = archive.by_name_decrypt("result.json", b"wrong password");
        assert!(result.is_err());
    }

    #[test]
    fn agile_encryption_round_trips_segments_key_and_integrity() {
        let plain = (0..10_117).map(|i| (i % 251) as u8).collect::<Vec<_>>();
        let package = build_agile_package(&plain, TEST_PASSWORD).expect("encrypt OOXML payload");
        let material = &package.test_material;

        let password_hash = derive_iterated_password_hash(TEST_PASSWORD, &material.password_salt);
        let key1 = derive_encryption_key(&password_hash, &PASSWORD_KEY_VERIFIER_INPUT);
        let key2 = derive_encryption_key(&password_hash, &PASSWORD_KEY_VERIFIER_HASH);
        let key3 = derive_encryption_key(&password_hash, &PASSWORD_KEY_ENCRYPTED_KEY);
        let verifier = decrypt_cbc_no_padding(
            &material.encrypted_verifier_hash_input,
            &key1,
            &material.password_salt,
        )
        .expect("decrypt verifier");
        let verifier_hash = decrypt_cbc_no_padding(
            &material.encrypted_verifier_hash_value,
            &key2,
            &material.password_salt,
        )
        .expect("decrypt verifier hash");
        assert_eq!(&Sha512::digest(verifier)[..], verifier_hash);
        assert_eq!(
            decrypt_cbc_no_padding(&material.encrypted_key_value, &key3, &material.password_salt)
                .expect("unwrap package key"),
            material.secret_key
        );
        assert_eq!(
            decrypt_payload_for_test(
                &package.encrypted_package,
                &material.secret_key,
                &material.data_salt,
            ),
            plain
        );

        let hmac_key = decrypt_cbc_no_padding(
            &material.encrypted_hmac_key,
            &material.secret_key,
            &derive_iv(&material.data_salt, &DATA_INTEGRITY_KEY),
        )
        .expect("decrypt HMAC key");
        assert_eq!(hmac_key, material.hmac_key);
        let hmac_value = decrypt_cbc_no_padding(
            &material.encrypted_hmac_value,
            &material.secret_key,
            &derive_iv(&material.data_salt, &DATA_INTEGRITY_VALUE),
        )
        .expect("decrypt HMAC value");
        let mut hmac = <HmacSha512 as Mac>::new_from_slice(&hmac_key).expect("HMAC key");
        hmac.update(&package.encrypted_package);
        assert_eq!(&hmac.finalize().into_bytes()[..], hmac_value);
    }

    #[test]
    fn invalid_ooxml_is_not_modified() {
        let path = TestPath::new("invalid-ooxml");
        fs::write(&path.0, b"original bytes").expect("write invalid input");
        assert!(encrypt_ooxml_in_place(&path.0, TEST_PASSWORD).is_err());
        assert_eq!(fs::read(&path.0).expect("read unchanged input"), b"original bytes");
    }

    fn compatibility_directory() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("export-crypto-compat")
    }

    fn write_compatibility_ooxml(file_name: &str, entry_name: &str, document: &[u8]) {
        let dir = compatibility_directory();
        fs::create_dir_all(&dir).expect("create scratchpad compatibility directory");
        let path = dir.join(file_name);
        test_zip(
            &path,
            &[
                (
                    "[Content_Types].xml",
                    b"<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/></Types>",
                ),
                (entry_name, document),
            ],
        );
        encrypt_ooxml_in_place(&path, TEST_PASSWORD).expect("encrypt compatibility sample");
    }

    #[test]
    #[ignore = "writes a DOCX sample for msoffcrypto compatibility verification"]
    fn msoffcrypto_can_decrypt_generated_docx() {
        write_compatibility_ooxml(
            "sample.docx",
            "word/document.xml",
            b"<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>test</w:t></w:r></w:p></w:body></w:document>",
        );
    }

    #[test]
    #[ignore = "writes an XLSX sample for msoffcrypto compatibility verification"]
    fn msoffcrypto_can_decrypt_generated_xlsx() {
        write_compatibility_ooxml(
            "sample.xlsx",
            "xl/workbook.xml",
            b"<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheets/></workbook>",
        );
    }

    #[test]
    #[ignore = "writes an AES ZIP sample for pyzipper compatibility verification"]
    fn pyzipper_can_decrypt_generated_aes_zip() {
        let dir = compatibility_directory();
        fs::create_dir_all(&dir).expect("create scratchpad compatibility directory");
        let input = dir.join("sample.json");
        fs::write(&input, br#"{"transcript":"test"}"#).expect("write AES ZIP sample");
        write_aes_zip(
            &input,
            &dir.join("sample-aes.zip"),
            "sample.json",
            TEST_PASSWORD,
        )
        .expect("write AES ZIP sample");
    }
}

