<?php

/**
 * Plugin Name: Bulk Image Cropper for WooCommerce
 * Description: Bulk crop main product images (parent + variations) with preview/commit system
 * Version: 1.3 - Production Stable
 * Author: S7Code&Design
 */

if (!defined('ABSPATH')) {
    exit;
}

class BulkImageCropper
{
    private $processing_start_time;
    private $max_execution_time;
    private $current_operation;

    private $log_file_path;
    private $max_log_size = 2097152; // 2MB

    public function __construct()
    {
        $this->max_execution_time = ini_get('max_execution_time') ?: 300;
        $this->init_logging();
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_scripts'));

        // Core AJAX handlers
        add_action('wp_ajax_get_product_categories', array($this, 'get_product_categories_ajax'));
        add_action('wp_ajax_get_products_by_category', array($this, 'get_products_by_category_ajax'));
        add_action('wp_ajax_get_product_images', array($this, 'get_product_images_ajax'));

        // Preview/Commit system - MAIN CROP HANDLERS
        add_action('wp_ajax_preview_crop', array($this, 'preview_crop_ajax'));
        add_action('wp_ajax_commit_preview', array($this, 'commit_preview_ajax'));
        add_action('wp_ajax_discard_preview', array($this, 'discard_preview_ajax'));

        // Utility handlers
        add_action('wp_ajax_reset_plugin_state', array($this, 'reset_plugin_state_ajax'));

        register_activation_hook(__FILE__, array($this, 'activate_plugin'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate_plugin'));

        add_action('wp_ajax_heartbeat', array($this, 'heartbeat_received'), 10, 2);
        add_action('wp_ajax_view_plugin_log', array($this, 'view_plugin_log_ajax'));
        add_action('wp_ajax_clear_plugin_logs', array($this, 'clear_plugin_logs_ajax'));
    }
    public function clear_plugin_logs_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('No permission');
        }

        if (file_exists($this->log_file_path)) {
            if (unlink($this->log_file_path)) {
                // Reinitialize logging
                $this->write_log('=== LOGS CLEARED BY USER ===');
                wp_send_json_success(array('message' => 'Logs cleared successfully'));
            } else {
                wp_send_json_error('Failed to delete log file');
            }
        } else {
            // Create empty log with message
            $this->write_log('=== NEW LOG SESSION STARTED ===');
            wp_send_json_success(array('message' => 'Log file was already empty'));
        }
    }
    public function view_plugin_log_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('No permission');
        }

        if (!file_exists($this->log_file_path)) {
            wp_send_json_success(array('logs' => 'No logs yet.'));
        }

        // Čitaj poslednje 100 linija
        $lines = file($this->log_file_path);
        $last_lines = array_slice($lines, -100);
        $logs = implode('', $last_lines);

        wp_send_json_success(array(
            'logs' => $logs,
            'file_size' => round(filesize($this->log_file_path) / 1024, 2) . 'KB'
        ));
    }
    private function init_logging()
    {
        // LOG DIREKT U PLUGIN FOLDER
        $plugin_dir = plugin_dir_path(__FILE__);
        $log_dir = $plugin_dir . 'logs';

        if (!file_exists($log_dir)) {
            wp_mkdir_p($log_dir);

            // Zaštiti folder sa .htaccess
            $htaccess_content = "Order deny,allow\nDeny from all\n";
            file_put_contents($log_dir . '/.htaccess', $htaccess_content);
        }

        $this->log_file_path = $log_dir . '/debug.log';
        // $this->write_log('=== PLUGIN STARTED ===');
    }

    private function write_log($message, $level = 'INFO')
    {
        if (!$this->log_file_path) return;

        // Rotate log if too big
        if (file_exists($this->log_file_path) && filesize($this->log_file_path) > $this->max_log_size) {
            if (file_exists($this->log_file_path . '.old')) {
                unlink($this->log_file_path . '.old');
            }
            rename($this->log_file_path, $this->log_file_path . '.old');
        }

        $timestamp = date('Y-m-d H:i:s');
        $log_line = "[{$timestamp}] [{$level}] {$message}" . PHP_EOL;

        file_put_contents($this->log_file_path, $log_line, FILE_APPEND | LOCK_EX);
    }
    // FAILSAFE HELPER FUNCTIONS
    private function start_operation($operation_name)
    {
        $this->processing_start_time = time();
        $this->current_operation = $operation_name;

        // KRAĆI LIMIT ZA SHARED HOSTING
        set_time_limit(75); // Smanjen sa 90 na 75 sekundi
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit();
        }

        // SAMO DEBUG LOG
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log('CROP OPERATION START: ' . $operation_name);
        }
    }
    private function check_operation_timeout()
    {
        if ($this->processing_start_time && (time() - $this->processing_start_time) > 60) { // Smanjen sa 75 na 60
            if (defined('WP_DEBUG') && WP_DEBUG) {
                error_log('FAILSAFE: Operation timeout detected for ' . $this->current_operation);
            }
            return true;
        }
        return false;
    }

    private function end_operation($success = true)
    {
        $duration = time() - $this->processing_start_time;
        $status = $success ? 'SUCCESS' : 'FAILED';

        // SAMO DEBUG LOG
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log('CROP OPERATION END: ' . $this->current_operation . ' - ' . $status . ' (' . $duration . 's)');
        }

        $this->processing_start_time = null;
        $this->current_operation = null;
    }

    public function activate_plugin()
    {
        $upload_dir = wp_upload_dir();
        $preview_dir = $upload_dir['basedir'] . '/crop-previews';

        if (!file_exists($preview_dir)) {
            wp_mkdir_p($preview_dir);
        }

        // Cleanup old previews
        $this->cleanup_old_previews();

        error_log('Bulk Image Cropper v1.3 ACTIVATED - Server: ' . ini_get('memory_limit') . ' memory, ' . $this->max_execution_time . 's time');
        add_option('bulk_image_cropper_activated', true);
    }

    public function deactivate_plugin()
    {
        // Cleanup previews on deactivation
        $this->cleanup_old_previews();

        delete_option('bulk_image_cropper_activated');
        error_log('Bulk Image Cropper v1.3 DEACTIVATED');
    }

    private function cleanup_old_previews()
    {
        $upload_dir = wp_upload_dir();
        $preview_dir = $upload_dir['basedir'] . '/crop-previews';

        if (file_exists($preview_dir)) {
            $files = glob($preview_dir . '/preview_*.jpg');
            $deleted = 0;

            foreach ($files as $file) {
                if (filemtime($file) < (time() - 7 * 24 * 60 * 60)) { // Starije od 7 dana
                    if (unlink($file)) {
                        $deleted++;
                    }
                }
            }

            if ($deleted > 0) {
                error_log('CLEANUP: Deleted ' . $deleted . ' old preview files');
            }
        }
    }

    public function heartbeat_received($response, $data)
    {
        if (isset($data['bulk_cropper_heartbeat'])) {
            $response['bulk_cropper_heartbeat'] = 'alive';

            // Heartbeat failsafe - proveri da li postoji zaglavljena operacija
            if ($this->processing_start_time && (time() - $this->processing_start_time) > 300) {
                error_log('FAILSAFE: Heartbeat detected stale operation, forcing cleanup');
                $this->end_operation(false);
            }
        }
        return $response;
    }

    public function add_admin_menu()
    {
        add_menu_page(
            'Bulk Image Cropper',
            'Bulk Cropper',
            'manage_options',
            'bulk-image-cropper',
            array($this, 'admin_page'),
            'dashicons-format-image',
            30
        );
    }

    public function enqueue_admin_scripts($hook)
    {
        if ($hook !== 'toplevel_page_bulk-image-cropper') {
            return;
        }

        wp_enqueue_script('jquery');
        wp_enqueue_script('heartbeat');
        wp_enqueue_script('bulk-cropper-js', plugin_dir_url(__FILE__) . 'bulk-admin.js', array('jquery', 'heartbeat'), '1.3', true);
        wp_enqueue_style('bulk-cropper-css', plugin_dir_url(__FILE__) . 'bulk-admin.css', array(), '1.3');

        wp_localize_script('bulk-cropper-js', 'ajax_object', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('bulk_cropper_nonce'),
            'max_execution_time' => $this->max_execution_time,
            'memory_limit' => ini_get('memory_limit') ?: '128M'
        ));
    }

    // MAIN CROP FUNCTION - PREVIEW ONLY
    public function preview_crop_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $this->start_operation('PREVIEW_CROP');

        $image_id = intval($_POST['image_id']);
        $padding = intval($_POST['padding'] ?? 40);
        $padding = max(0, min($padding, 200)); // Ograniči padding

        // Failsafe - proveri timeout na početku
        if ($this->check_operation_timeout()) {
            wp_send_json_error(array('message' => 'Operation timeout before start'));
        }

        $result = $this->create_preview_crop($image_id, $padding);

        $this->end_operation($result['success']);

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    public function commit_preview_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $this->start_operation('COMMIT_PREVIEW');

        // KRAĆI TIMEOUT za commit operacije
        set_time_limit(60); // umesto 75s

        $image_id = intval($_POST['image_id']);
        $result = $this->commit_preview_to_original($image_id);

        if ($result['success']) {
            $this->clear_image_caches($image_id);
        }

        $this->end_operation($result['success']);

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    public function discard_preview_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $image_id = intval($_POST['image_id']);
        $result = $this->discard_preview($image_id);

        wp_send_json_success($result);
    }

    public function admin_page()
    {
?>
        <div class="wrap">
            <h1>🚀 Bulk Image Cropper v1.3 - Production Stable</h1>
            <p><strong>Optimized workflow:</strong> Select up to 3 products → Crop all images → Save results</p>

            <div class="bulk-cropper-container">
                <div class="top-row">
                    <div class="section category-section">
                        <h2>📁 Kategorija:</h2>
                        <div class="category-controls">
                            <select id="category-select" style="width: 300px;">
                                <option value="">Učitavanje kategorija...</option>
                            </select>
                            <button id="load-category-products" class="button button-primary" disabled>Učitaj Proizvode</button>

                            <div class="search-controls">
                                <input type="text" id="search-products" placeholder="Pretraži proizvode..." style="width: 250px; padding: 6px 8px;">
                                <button id="clear-search" class="button button-secondary" style="display: none;">✕</button>
                            </div>

                            <button id="reset-plugin" class="button button-secondary">🔄 Reset</button>
                        </div>
                        <div id="category-info"></div>
                    </div>

                    <div class="section progress-results-section">
                        <div id="live-progress" style="display: none;">
                            <h3>🔄 Trenutni Progres</h3>
                            <div class="mini-progress-bar">
                                <div class="mini-progress-fill" id="mini-progress-fill"></div>
                            </div>
                            <div id="mini-progress-text">Ready</div>
                        </div>

                        <div id="quick-results" style="display: none;">
                            <h3>📊 Rezultati</h3>
                            <div id="quick-results-content"></div>
                        </div>
                    </div>
                </div>

                <div class="main-row">
                    <div class="products-column">
                        <div class="section">
                            <h2>🛍️ Proizvodi <span id="product-count"></span></h2>

                            <div class="compact-pagination">
                                <button id="prev-page" class="button-small" disabled>← Prev</button>
                                <span id="page-info">Page 1 of 1</span>
                                <button id="next-page" class="button-small" disabled>Next →</button>
                                <select id="per-page-select">
                                    <option value="20">20</option>
                                    <option value="50" selected>50</option>
                                    <option value="100">100</option>
                                </select>
                            </div>

                            <div id="products-grid"></div>
                        </div>

                        <div class="section selected-summary" style="display: none;">
                            <h3>✅ Izabrani Proizvodi</h3>
                            <div class="selected-products-controls">
                                <span id="selected-products-count">0 izabrano</span>
                                <button id="load-all-selected-images" class="button button-primary" disabled>Učitaj Slike</button>
                                <button id="clear-selection" class="button" disabled>Obriši</button>
                            </div>
                            <div id="selected-products-preview"></div>
                        </div>
                    </div>

                    <div class="images-column">
                        <div class="section">
                            <h2>🎯 Glavne Slike za Cropovanje</h2>
                            <p><em>Maximum 3 products (~50 images) recommended for optimal performance</em></p>

                            <div class="crop-controls">
                                <div class="selection-controls">
                                    <button id="select-all-images" class="button-small">Sve</button>
                                    <button id="deselect-all-images" class="button-small">Nijedna</button>
                                    <span id="selected-count">0 selected</span>
                                </div>

                                <button id="crop-selected" class="button button-primary" disabled>Crop Selected (40px)</button>
                            </div>

                            <div id="images-grid"></div>
                        </div>
                    </div>
                </div>

                <div class="section" id="detailed-progress-section" style="display: none;">
                    <h2>📈 Detaljan Progres</h2>
                    <div class="progress-bar">
                        <div class="progress-fill" id="progress-fill"></div>
                    </div>
                    <div id="progress-text">0 / 0</div>
                    <div id="progress-log"></div>
                    <button id="toggle-detailed-log" class="button button-small">Show/Hide Log</button>
                </div>

                <div class="section" id="cropped-images-section" style="display: none;">
                    <h2>🖼️ Cropped Results</h2>

                    <div class="bulk-save-controls" style="margin: 15px 0; padding: 15px; background: #f0f8e7; border: 1px solid #00a32a; border-radius: 5px; text-align: center;">
                        <button id="bulk-save-all-crops" class="button button-primary" style="background: #00a32a !important; border-color: #00a32a !important; font-weight: bold; font-size: 14px; padding: 10px 20px;">💾 Save All Cropped Images</button>
                        <span style="margin-left: 15px; color: #646970; font-size: 13px;">This will permanently replace original images with cropped versions.</span>
                    </div>

                    <div id="cropped-images-grid"></div>
                </div>

                <div class="usage-tips" style="background: #e8f5e8; padding: 15px; margin: 15px 0; border-left: 4px solid #00a32a;">
                    <h4>📋 Optimized Workflow:</h4>
                    <ul style="margin: 10px 0;">
                        <li><strong>Select:</strong> Maximum 3 products (~50 images total)</li>
                        <li><strong>Crop All:</strong> Process all images at once with 40px padding</li>
                        <li><strong>Save All:</strong> Bulk save all successful results</li>
                        <li><strong>Time:</strong> ~3-5 minutes per batch</li>
                    </ul>
                    <p style="margin: 5px 0; color: #646970; font-size: 13px;"><em>This approach ensures system stability and optimal performance.</em></p>
                </div>
                <div class="section" style="background: #f8f9fa; border-left: 4px solid #17a2b8;">
                    <h2>🔍 Plugin Debug Log</h2>
                    <div style="margin-bottom: 15px;">
                        <button id="show-log" class="button button-primary">📋 Show Recent Log</button>
                        <button id="refresh-log" class="button button-secondary">🔄 Refresh</button>
                        <button id="clear-log" class="button button-secondary">🗑️ Clear Log</button>
                        <span id="log-info" style="margin-left: 15px; color: #646970; font-size: 13px;"></span>
                    </div>

                    <div id="log-display" style="display:none;">
                        <div style="background: #000; color: #00ff00; padding: 15px; border-radius: 5px; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; max-height: 400px; overflow-y: auto; white-space: pre-wrap; line-height: 1.4;" id="log-content">
                            Click "Show Recent Log" to load debug information...
                        </div>
                        <div style="margin-top: 10px; font-size: 12px; color: #646970;">
                            <strong>Location:</strong> /wp-content/plugins/bulk-image-cropper/logs/debug.log |
                            <strong>Auto-rotates:</strong> when size exceeds 2MB
                        </div>
                    </div>
                </div>
            </div>
        </div>
<?php
    }

    public function reset_plugin_state_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        // Clean up any processing state
        $this->end_operation(false);

        // Clean up old previews
        $this->cleanup_old_previews();

        wp_send_json_success(array('message' => 'Plugin state reset successfully'));
    }

    public function get_product_categories_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');
        set_time_limit(30); // Kratko vreme za categories

        $categories = get_terms(array(
            'taxonomy' => 'product_cat',
            'hide_empty' => true,
            'orderby' => 'name',
            'order' => 'ASC',
            'number' => 200
        ));

        if (is_wp_error($categories)) {
            wp_send_json_error('Failed to load categories');
            return;
        }

        $categories_data = array();
        $categories_data[] = array(
            'id' => 'all',
            'name' => 'All Categories',
            'count' => 0
        );

        foreach ($categories as $category) {
            $categories_data[] = array(
                'id' => $category->term_id,
                'name' => $category->name,
                'count' => $category->count,
                'slug' => $category->slug,
                'parent' => $category->parent
            );
        }

        wp_send_json_success($categories_data);
    }

    public function get_products_by_category_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        set_time_limit(60);
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit();
        }

        $category_id = sanitize_text_field($_POST['category_id'] ?? '');
        $search_term = sanitize_text_field($_POST['search_term'] ?? '');
        $page = intval($_POST['page'] ?? 1);
        $per_page = min(intval($_POST['per_page'] ?? 50), 100);
        $offset = ($page - 1) * $per_page;

        $args = array(
            'post_type' => 'product',
            'post_status' => 'publish',
            'posts_per_page' => $per_page,
            'offset' => $offset,
            'fields' => 'ids',
            'no_found_rows' => false,
            'update_post_meta_cache' => false,
            'update_post_term_cache' => false,
            'meta_query' => array(
                array(
                    'key' => '_thumbnail_id',
                    'compare' => 'EXISTS'
                )
            )
        );

        if (!empty($search_term)) {
            $args['s'] = $search_term;
        }

        if ($category_id !== 'all' && !empty($category_id)) {
            $args['tax_query'] = array(
                array(
                    'taxonomy' => 'product_cat',
                    'field' => 'term_id',
                    'terms' => $category_id
                )
            );
        }

        $query = new WP_Query($args);
        $product_ids = $query->posts;
        $total_products = $query->found_posts;

        $products_data = array();

        foreach ($product_ids as $product_id) {
            $product_obj = wc_get_product($product_id);
            if (!$product_obj) continue;

            $thumbnail_id = $product_obj->get_image_id();

            $variation_images_count = 0;
            if ($product_obj->is_type('variable')) {
                $variations = $product_obj->get_children();
                $variation_images_count = count(array_filter($variations, function ($var_id) {
                    $var = wc_get_product($var_id);
                    return $var && $var->get_image_id();
                }));
            }

            $total_images = ($thumbnail_id ? 1 : 0) + $variation_images_count;

            if ($total_images > 0) {
                $products_data[] = array(
                    'id' => $product_id,
                    'title' => $product_obj->get_name(),
                    'type_label' => $product_obj->is_type('variable') ? 'Variable' : 'Simple',
                    'image_count' => $total_images,
                    'thumbnail_url' => wp_get_attachment_image_url($thumbnail_id, 'thumbnail'),
                    'edit_url' => admin_url('post.php?post=' . $product_id . '&action=edit'),
                    'type' => $product_obj->get_type(),
                    'price' => $product_obj->get_price_html(),
                    'sku' => $product_obj->get_sku()
                );
            }
        }

        $total_pages = ceil($total_products / $per_page);

        wp_send_json_success(array(
            'products' => $products_data,
            'pagination' => array(
                'current_page' => $page,
                'total_pages' => $total_pages,
                'per_page' => $per_page,
                'total_products' => $total_products,
                'showing' => count($products_data)
            ),
            'search_term' => $search_term
        ));
    }

    public function get_product_images_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        set_time_limit(120);
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit();
        }

        $product_ids = array_map('intval', $_POST['product_ids'] ?? array());

        if (empty($product_ids)) {
            wp_send_json_error('No product IDs provided');
        }

        // FAILSAFE: Ograniči broj proizvoda
        if (count($product_ids) > 5) {
            wp_send_json_error('Molim vas selektujte maksimalno 5 proizvoda odjednom za stabilnost sistema.');
        }

        $all_images = array();
        $total_images = 0;

        foreach ($product_ids as $product_id) {
            $product = wc_get_product($product_id);
            if (!$product) continue;

            $thumbnail_id = $product->get_image_id();
            $product_image_ids = array();

            if ($thumbnail_id) {
                $product_image_ids[] = $thumbnail_id;
            }

            if ($product->is_type('variable')) {
                $variations = $product->get_children();
                foreach ($variations as $variation_id) {
                    $variation_obj = wc_get_product($variation_id);
                    if ($variation_obj && $variation_obj->get_image_id()) {
                        $var_image_id = $variation_obj->get_image_id();
                        if (!in_array($var_image_id, $product_image_ids)) {
                            $product_image_ids[] = $var_image_id;
                        }
                    }
                }
            }

            foreach ($product_image_ids as $image_id) {
                $image_url = wp_get_attachment_image_url($image_id, 'medium');
                $full_url = wp_get_attachment_image_url($image_id, 'full');
                $image_meta = wp_get_attachment_metadata($image_id);

                if ($image_url) {
                    $badge_text = '';
                    $variation_info = '';

                    if ($image_id == $thumbnail_id) {
                        $badge_text = 'Main';
                    } else {
                        if ($product->is_type('variable')) {
                            $variations = $product->get_children();
                            foreach ($variations as $variation_id) {
                                $variation_obj = wc_get_product($variation_id);
                                if ($variation_obj && $variation_obj->get_image_id() == $image_id) {
                                    $badge_text = 'Variation';
                                    $variation_info = ' (Var: ' . $variation_obj->get_name() . ')';
                                    break;
                                }
                            }
                        }
                    }

                    $all_images[] = array(
                        'id' => $image_id,
                        'url' => $image_url,
                        'full_url' => $full_url,
                        'title' => get_the_title($image_id) . $variation_info,
                        'size' => isset($image_meta['width']) ? $image_meta['width'] . 'x' . $image_meta['height'] : 'Unknown',
                        'badge' => $badge_text,
                        'product_id' => $product_id,
                        'product_name' => $product->get_name()
                    );

                    $total_images++;
                }
            }
        }

        // FAILSAFE: Ograniči ukupan broj slika
        if ($total_images > 100) {
            wp_send_json_error('Previše slika (' . $total_images . '). Molim vas selektujte manje proizvoda (max ~100 slika).');
        }

        wp_send_json_success(array(
            'images' => $all_images,
            'total_images' => count($all_images),
            'products_count' => count($product_ids)
        ));
    }

    // CORE CROP FUNCTION - SA PRODUCTION FAILSAFE
    private function create_preview_crop($image_id, $padding = 40)
    {
        $this->write_log("=== CROP START - Image: {$image_id}, Padding: {$padding}px ===");

        // PRODUCTION EMERGENCY LIMITS
        $original_time_limit = ini_get('max_execution_time');
        set_time_limit(90);

        $start_wall_time = time();
        $max_wall_time = 80;

        $image_path = get_attached_file($image_id);
        $this->write_log("Image path: {$image_path}");

        if (!$image_path || !file_exists($image_path)) {
            $this->write_log("ERROR: Image file not found", 'ERROR');
            set_time_limit($original_time_limit);
            return array('success' => false, 'message' => 'Image file not found');
        }

        // File size check
        $file_size = filesize($image_path);
        $file_size_mb = round($file_size / 1024 / 1024, 2);
        $this->write_log("File size: {$file_size_mb}MB");

        if ($file_size > 5 * 1024 * 1024) { // Smanjen limit na 5MB za produkciju
            $this->write_log("ERROR: Image too large: {$file_size_mb}MB", 'ERROR');
            set_time_limit($original_time_limit);
            return array('success' => false, 'message' => "Image too large ({$file_size_mb}MB). Max 5MB on production.");
        }

        // Environment detection
        $server_name = $_SERVER['HTTP_HOST'] ?? '';
        $is_localhost = strpos($server_name, 'localhost') !== false || strpos($server_name, '.local') !== false;
        $environment = $is_localhost ? 'localhost' : 'production';
        $this->write_log("Environment: {$environment}");

        // PRODUCTION SAFETY CHECK
        if (!$is_localhost) {
            $this->write_log("PRODUCTION MODE: Using ultra-safe settings");

            // Test if exec() is even allowed
            if (!function_exists('exec')) {
                $this->write_log("ERROR: exec() function disabled on server", 'ERROR');
                set_time_limit($original_time_limit);
                return array('success' => false, 'message' => 'Server security: exec() function disabled');
            }

            // Test basic command first
            $test_output = array();
            $test_return = -1;
            exec('echo "test" 2>&1', $test_output, $test_return);

            if ($test_return !== 0) {
                $this->write_log("ERROR: Basic exec() test failed, return: {$test_return}", 'ERROR');
                set_time_limit($original_time_limit);
                return array('success' => false, 'message' => 'Server security: command execution blocked');
            }

            $this->write_log("exec() function test passed");
        }

        // Python path with extensive testing
        $python_path = $this->get_python_path_safe();
        $this->write_log("Python path: {$python_path}");

        $script_path = plugin_dir_path(__FILE__) . 'cropper.py';
        $this->write_log("Script path: {$script_path}");

        if (!file_exists($script_path)) {
            $this->write_log("ERROR: Python script not found", 'ERROR');
            set_time_limit($original_time_limit);
            return array('success' => false, 'message' => 'Python script not found');
        }

        // Setup preview
        $upload_dir = wp_upload_dir();
        $preview_dir = $upload_dir['basedir'] . '/crop-previews';
        if (!file_exists($preview_dir)) {
            wp_mkdir_p($preview_dir);
            $this->write_log("Created preview directory");
        }

        $preview_path = $preview_dir . '/preview_' . $image_id . '_' . $padding . 'px_' . time() . '.jpg';
        $this->write_log("Preview will be saved to: {$preview_path}");

        // ULTRA SAFE COMMAND BUILDING
        if ($is_localhost) {
            $command = escapeshellcmd($python_path . ' ' . $script_path . ' ' .
                escapeshellarg($image_path) . ' ' .
                escapeshellarg($preview_path) . ' ' .
                intval($padding));
            $command .= ' 2>&1';
            $timeout_limit = 30;
        } else {
            // PRODUCTION: Multiple timeout layers
            $base_cmd = escapeshellcmd($python_path . ' ' . $script_path . ' ' .
                escapeshellarg($image_path) . ' ' .
                escapeshellarg($preview_path) . ' ' .
                intval($padding));

            // Force timeout na produkciji
            $command = $base_cmd . " 2>&1";
            $timeout_limit = 65;
        }

        $this->write_log("Command: {$command}");

        // ULTRA SAFE EXECUTION
        $start_time = microtime(true);
        $this->write_log("Starting Python execution...");

        $output = array();
        $return_var = -1;

        // Wall time check before execution
        if ((time() - $start_wall_time) > ($max_wall_time - 5)) {
            $this->write_log("ERROR: Wall time exceeded before Python execution", 'ERROR');
            set_time_limit($original_time_limit);
            return array('success' => false, 'message' => 'Operation timeout before execution');
        }

        // Execute with immediate timeout check
        $exec_start = time();
        exec($command, $output, $return_var);
        $exec_duration = time() - $exec_start;

        $execution_time = microtime(true) - $start_time;
        $total_wall_time = time() - $start_wall_time;

        $this->write_log("Python finished in " . round($execution_time, 2) . "s, exec duration: {$exec_duration}s, wall time: {$total_wall_time}s, return code: {$return_var}");

        if (!empty($output)) {
            $this->write_log("Python output: " . implode(' | ', array_slice($output, 0, 10))); // Max 10 lines
        }

        // EMERGENCY TIMEOUT CHECK
        if ($total_wall_time > $max_wall_time || $exec_duration > 15) {
            $this->write_log("ERROR: Emergency timeout triggered - wall: {$total_wall_time}s, exec: {$exec_duration}s", 'ERROR');
            set_time_limit($original_time_limit);
            return array('success' => false, 'message' => 'Emergency timeout - server protection activated');
        }

        set_time_limit($original_time_limit);

        if ($return_var === 0 && file_exists($preview_path)) {
            $this->write_log("SUCCESS: Preview created successfully");

            $preview_url = $upload_dir['baseurl'] . '/crop-previews/' . basename($preview_path) . '?v=' . time();
            $preview_size = getimagesize($preview_path);
            $preview_dimensions = $preview_size ? $preview_size[0] . 'x' . $preview_size[1] : 'Unknown';

            return array(
                'success' => true,
                'image_id' => $image_id,
                'message' => "Preview created with {$padding}px padding in " . round($execution_time, 1) . "s",
                'preview_url' => $preview_url,
                'preview_path' => $preview_path,
                'preview_size' => $preview_dimensions,
                'padding_used' => $padding,
                'execution_time' => round($execution_time, 2),
                'environment' => $environment
            );
        } else {
            // Enhanced error handling
            $this->write_log("ERROR: Crop failed - return code {$return_var}, wall time: {$total_wall_time}s", 'ERROR');

            $error_msg = 'Crop failed';
            if ($return_var === 127) {
                $error_msg = 'Python not found - check server installation';
            } elseif ($return_var === 124) {
                $error_msg = 'Python timeout - operation too slow for shared hosting';
            } elseif ($return_var === 1) {
                $error_msg = 'Python libraries missing (PIL/NumPy)';
            } elseif ($return_var === 2) {
                $error_msg = 'Python script error - check file permissions';
            } elseif ($return_var !== 0) {
                $error_msg = 'Python error (code: ' . $return_var . ')';
            }

            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => $error_msg,
                'return_code' => $return_var,
                'execution_time' => round($execution_time, 2),
                'wall_time' => $total_wall_time,
                'environment' => $environment
            );
        }
    }
    // NOVA SAFE PYTHON PATH FUNKCIJA
    private function get_python_path_safe()
    {
        $server_name = $_SERVER['HTTP_HOST'] ?? '';
        $is_localhost = strpos($server_name, 'localhost') !== false || strpos($server_name, '.local') !== false;

        if ($is_localhost) {
            return 'python'; // Localhost fallback
        }

        // PRODUCTION: Test multiple paths sa timeout
        $production_paths = array(
            '/opt/alt/python311/bin/python3.11',
            '/usr/bin/python3',
            '/usr/bin/python',
            'python3',
            'python'
        );

        foreach ($production_paths as $path) {
            $this->write_log("Testing Python path: {$path}");

            $test_output = array();
            $test_return = -1;

            // Quick version test with timeout
            $test_cmd = "timeout 5 {$path} --version 2>/dev/null";
            exec($test_cmd, $test_output, $test_return);

            if ($test_return === 0) {
                $this->write_log("SUCCESS: Python found at {$path}");
                return $path;
            }

            $this->write_log("FAILED: Python test at {$path}, return: {$test_return}");
        }

        $this->write_log("ERROR: No working Python path found", 'ERROR');
        return '/opt/alt/python311/bin/python3.11'; // Fallback
    }
    private function commit_preview_to_original($image_id)
    {
        // BULLETPROOF FAILSAFE for commit operation
        $start_time = time();
        $max_commit_time = 45; // 45 seconds max

        $image_path = get_attached_file($image_id);
        $upload_dir = wp_upload_dir();
        $preview_dir = $upload_dir['basedir'] . '/crop-previews';

        if (!$image_path || !file_exists($image_path)) {
            return array(
                'success' => false,
                'message' => 'Original image not found'
            );
        }

        // Find preview files
        $preview_files = glob($preview_dir . '/preview_' . $image_id . '_*.jpg');

        if (empty($preview_files)) {
            return array(
                'success' => false,
                'message' => 'No preview found to commit'
            );
        }

        // Get latest preview
        $latest_preview = array_reduce($preview_files, function ($latest, $current) {
            return (filemtime($current) > filemtime($latest)) ? $current : $latest;
        }, $preview_files[0]);

        // TIMEOUT CHECK #1
        if ((time() - $start_time) > ($max_commit_time - 10)) {
            return array('success' => false, 'message' => 'Commit timeout - operation too slow');
        }

        // Create backup if doesn't exist
        $backup_path = $image_path . '.backup';
        if (!file_exists($backup_path)) {
            $copy_start = time();
            if (!copy($image_path, $backup_path) || (time() - $copy_start) > 5) {
                return array('success' => false, 'message' => 'Backup creation failed or timeout');
            }
        }

        // TIMEOUT CHECK #2
        if ((time() - $start_time) > ($max_commit_time - 5)) {
            return array('success' => false, 'message' => 'Commit timeout before copy');
        }

        // Get original format info
        $original_info = pathinfo($image_path);
        $original_ext = strtolower($original_info['extension']);

        // SMART FORMAT HANDLING for .webp, .png, .jpg, .jpeg
        $copy_start = time();

        if (in_array($original_ext, ['webp', 'png', 'jpg', 'jpeg'])) {
            // For web formats, convert preview to match original format
            $converted_path = $this->convert_preview_to_format($latest_preview, $image_path, $original_ext);

            if ($converted_path && file_exists($converted_path)) {
                $copy_success = rename($converted_path, $image_path);
            } else {
                // Fallback to direct copy
                $copy_success = copy($latest_preview, $image_path);
            }
        } else {
            // Direct copy for other formats
            $copy_success = copy($latest_preview, $image_path);
        }

        $copy_time = time() - $copy_start;

        // TIMEOUT CHECK #3
        if ($copy_time > 10 || (time() - $start_time) > $max_commit_time) {
            return array('success' => false, 'message' => 'File copy timeout (' . $copy_time . 's)');
        }

        if ($copy_success) {
            // FAST regeneration - only essential sizes
            $this->fast_regenerate_essential_sizes($image_id);

            // Clean up ALL previews for this image
            foreach ($preview_files as $preview_file) {
                @unlink($preview_file);
            }

            // Get final image info
            $image_meta = wp_get_attachment_metadata($image_id);
            $final_time = time() - $start_time;

            error_log('COMMIT SUCCESS: Image ' . $image_id . ' in ' . $final_time . 's, Format: ' . $original_ext);

            return array(
                'success' => true,
                'image_id' => $image_id,
                'message' => 'Preview committed successfully (' . $final_time . 's)',
                'new_size' => isset($image_meta['width']) ? $image_meta['width'] . 'x' . $image_meta['height'] : 'Unknown',
                'committed_url' => wp_get_attachment_image_url($image_id, 'full') . '?v=' . time(),
                'format' => $original_ext,
                'execution_time' => $final_time
            );
        } else {
            return array(
                'success' => false,
                'message' => 'Failed to commit preview - file copy error after ' . $copy_time . 's'
            );
        }
    }
    private function convert_preview_to_format($preview_path, $target_path, $target_format)
    {
        try {
            $start_time = time();

            // Load preview image
            $preview_image = imagecreatefromjpeg($preview_path);
            if (!$preview_image) return false;

            // Timeout check
            if ((time() - $start_time) > 5) {
                imagedestroy($preview_image);
                return false;
            }

            $temp_path = $target_path . '.tmp';
            $success = false;

            switch ($target_format) {
                case 'webp':
                    if (function_exists('imagewebp')) {
                        $success = imagewebp($preview_image, $temp_path, 90);
                    }
                    break;

                case 'png':
                    // For PNG, preserve transparency if needed
                    imagealphablending($preview_image, false);
                    imagesavealpha($preview_image, true);
                    $success = imagepng($preview_image, $temp_path, 6);
                    break;

                case 'jpg':
                case 'jpeg':
                    $success = imagejpeg($preview_image, $temp_path, 95);
                    break;
            }

            imagedestroy($preview_image);

            if ($success && file_exists($temp_path) && (time() - $start_time) <= 8) {
                return $temp_path;
            } else {
                @unlink($temp_path);
                return false;
            }
        } catch (Exception $e) {
            error_log('FORMAT CONVERSION ERROR: ' . $e->getMessage());
            return false;
        }
    }
    private function discard_preview($image_id)
    {
        $upload_dir = wp_upload_dir();
        $preview_dir = $upload_dir['basedir'] . '/crop-previews';

        $preview_files = glob($preview_dir . '/preview_' . $image_id . '_*.jpg');
        $deleted_count = 0;

        foreach ($preview_files as $preview_file) {
            if (unlink($preview_file)) {
                $deleted_count++;
            }
        }

        return array(
            'success' => true,
            'image_id' => $image_id,
            'message' => "Discarded {$deleted_count} preview(s)",
            'deleted_count' => $deleted_count
        );
    }

    private function clear_image_caches($image_id)
    {
        wp_cache_delete($image_id, 'posts');
        clean_attachment_cache($image_id);

        // Clear WooCommerce product caches
        if (function_exists('wc_delete_product_transients')) {
            global $wpdb;
            $products = $wpdb->get_col($wpdb->prepare("
                SELECT post_id FROM {$wpdb->postmeta} 
                WHERE meta_key IN ('_thumbnail_id', '_product_image_gallery') 
                AND meta_value LIKE %s
            ", '%' . $image_id . '%'));

            foreach ($products as $product_id) {
                wc_delete_product_transients($product_id);
            }
        }
    }

    private function regenerate_image_sizes($image_id)
    {
        $image_path = get_attached_file($image_id);
        if (!$image_path) return false;

        $metadata = wp_generate_attachment_metadata($image_id, $image_path);
        wp_update_attachment_metadata($image_id, $metadata);

        return true;
    }

    private function fast_regenerate_essential_sizes($image_id)
    {
        $start_time = time();

        $image_path = get_attached_file($image_id);
        if (!$image_path || !file_exists($image_path)) return false;

        // Quick timeout check
        if ((time() - $start_time) > 3) return false;

        // Get only essential WordPress sizes
        $essential_sizes = array('thumbnail', 'medium', 'medium_large', 'large');

        $metadata = wp_get_attachment_metadata($image_id);
        if (!$metadata) {
            $metadata = wp_generate_attachment_metadata($image_id, $image_path);
        }

        // Quick regeneration of only essential sizes
        $editor = wp_get_image_editor($image_path);
        if (!is_wp_error($editor)) {
            $resized = $editor->multi_resize($essential_sizes);
            if ($resized) {
                $metadata['sizes'] = array_merge($metadata['sizes'] ?? array(), $resized);
            }
        }

        wp_update_attachment_metadata($image_id, $metadata);

        $duration = time() - $start_time;
        error_log('FAST REGEN: Image ' . $image_id . ' in ' . $duration . 's');

        return true;
    }

    // TAKOĐE TREBAS I OVU get_python_path() FUNKCIJU:
    private function get_python_path()
    {
        // AUTO-DETECT LOCALHOST VS PRODUCTION
        $server_name = $_SERVER['HTTP_HOST'] ?? '';
        $document_root = $_SERVER['DOCUMENT_ROOT'] ?? '';

        $is_localhost = in_array($server_name, ['localhost', '127.0.0.1']) ||
            strpos($server_name, 'localhost') !== false ||
            strpos($server_name, '.local') !== false ||
            strpos($document_root, 'xampp') !== false ||
            strpos($document_root, 'wamp') !== false ||
            strpos($document_root, 'mamp') !== false;

        if ($is_localhost) {
            // LOCALHOST PATHS
            $localhost_paths = array('python', 'python3');

            // Windows specific paths
            if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
                array_unshift($localhost_paths, 'C:\\Python\\python.exe', 'C:\\Python39\\python.exe', 'C:\\Python311\\python.exe');
            }

            foreach ($localhost_paths as $path) {
                $null_redirect = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN' ? '2>nul' : '2>/dev/null';
                $test_command = $path . ' --version ' . $null_redirect;
                exec($test_command, $output, $return_var);
                if ($return_var === 0) {
                    error_log('LOCALHOST PYTHON: Using ' . $path);
                    return $path;
                }
                $output = array(); // Clear output for next iteration
            }

            error_log('LOCALHOST ERROR: No Python found');
            return 'python'; // Fallback
        }

        // PRODUCTION PATH - za tvoj hosting
        $production_path = '/opt/alt/python311/bin/python3.11';

        $test_command = $production_path . ' --version 2>/dev/null';
        exec($test_command, $output, $return_var);

        if ($return_var === 0) {
            error_log('PRODUCTION PYTHON: Using ' . $production_path);
            return $production_path;
        }

        // Fallback paths za produkciju
        $fallback_paths = array(
            '/usr/bin/python3',
            '/usr/bin/python',
            'python3',
            'python'
        );

        foreach ($fallback_paths as $path) {
            $test_command = $path . ' --version 2>/dev/null';
            exec($test_command, $output, $return_var);
            if ($return_var === 0) {
                error_log('PRODUCTION FALLBACK: Using ' . $path);
                return $path;
            }
            $output = array(); // Clear output
        }

        error_log('PRODUCTION ERROR: No working Python path found');
        return $production_path; // Return production path kao poslednja opcija
    }
}

new BulkImageCropper();
