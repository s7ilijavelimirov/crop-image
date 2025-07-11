<?php

/**
 * Plugin Name: Bulk Image Cropper for WooCommerce
 * Description: Bulk crop main product images (parent + variations) with preview/commit system
 * Version: 1.1
 * Author: S7Code&Design
 */

if (!defined('ABSPATH')) {
    exit;
}

class BulkImageCropper
{

    public function __construct()
    {
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_scripts'));
        add_action('wp_ajax_get_product_categories', array($this, 'get_product_categories_ajax'));
        add_action('wp_ajax_get_products_by_category', array($this, 'get_products_by_category_ajax'));
        add_action('wp_ajax_get_product_images', array($this, 'get_product_images_ajax'));
        add_action('wp_ajax_crop_selected_images', array($this, 'crop_selected_images_ajax'));
        add_action('wp_ajax_crop_single_image', array($this, 'crop_single_image_ajax'));
        add_action('wp_ajax_reset_plugin_state', array($this, 'reset_plugin_state_ajax'));

        add_action('wp_ajax_crop_with_padding', array($this, 'crop_with_padding_ajax'));
        add_action('wp_ajax_restore_image_backup', array($this, 'restore_image_backup_ajax'));
        add_action('wp_ajax_get_backup_status', array($this, 'get_backup_status_ajax'));

        // Preview/Commit system
        add_action('wp_ajax_preview_crop', array($this, 'preview_crop_ajax'));
        add_action('wp_ajax_commit_preview', array($this, 'commit_preview_ajax'));
        add_action('wp_ajax_discard_preview', array($this, 'discard_preview_ajax'));

        register_activation_hook(__FILE__, array($this, 'activate_plugin'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate_plugin'));

        add_action('wp_ajax_heartbeat', array($this, 'heartbeat_received'), 10, 2);
    }

    public function activate_plugin()
    {
        $upload_dir = wp_upload_dir();
        $cropped_dir = $upload_dir['basedir'] . '/cropped-images';
        $preview_dir = $upload_dir['basedir'] . '/crop-previews';

        if (!file_exists($cropped_dir)) {
            wp_mkdir_p($cropped_dir);
        }

        if (!file_exists($preview_dir)) {
            wp_mkdir_p($preview_dir);
        }

        error_log('Bulk Image Cropper v1.1 aktiviran - Server: ' . ini_get('memory_limit') . ' memorije, ' . ini_get('max_execution_time') . 's vremena');
        add_option('bulk_image_cropper_activated', true);
    }

    public function deactivate_plugin()
    {
        delete_option('bulk_image_cropper_activated');
        error_log('Bulk Image Cropper v1.1 deactivated');
    }

    public function heartbeat_received($response, $data)
    {
        if (isset($data['bulk_cropper_heartbeat'])) {
            $response['bulk_cropper_heartbeat'] = 'alive';
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
        wp_enqueue_script('bulk-cropper-js', plugin_dir_url(__FILE__) . 'bulk-admin.js', array('jquery', 'heartbeat'), '1.1', true);
        wp_enqueue_style('bulk-cropper-css', plugin_dir_url(__FILE__) . 'bulk-admin.css', array(), '1.1');

        wp_localize_script('bulk-cropper-js', 'ajax_object', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('bulk_cropper_nonce'),
            'max_execution_time' => ini_get('max_execution_time') ?: 30,
            'memory_limit' => ini_get('memory_limit') ?: '128M'
        ));
    }

    // PREVIEW CROP - ne diramo original
    public function preview_crop_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        set_time_limit(60);
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit();
        }

        $image_id = intval($_POST['image_id']);
        $padding = intval($_POST['padding'] ?? 10);
        $padding = max(0, min($padding, 100));

        $result = $this->create_preview_crop($image_id, $padding);

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    // COMMIT PREVIEW - sacuvaj preview kao original
    public function commit_preview_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $image_id = intval($_POST['image_id']);
        $result = $this->commit_preview_to_original($image_id);

        if ($result['success']) {
            $this->clear_image_caches($image_id);
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    // DISCARD PREVIEW - obriši preview
    public function discard_preview_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $image_id = intval($_POST['image_id']);
        $result = $this->discard_preview($image_id);

        wp_send_json_success($result);
    }

    public function crop_with_padding_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        set_time_limit(60);
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit();
        }

        $image_id = intval($_POST['image_id']);
        $padding = intval($_POST['padding'] ?? 10);
        $padding = max(0, min($padding, 100));

        $result = $this->crop_image_by_id($image_id, $padding);

        if ($result['success']) {
            $this->clear_image_caches($image_id);
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    public function restore_image_backup_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $image_id = intval($_POST['image_id']);
        $result = $this->restore_from_backup($image_id);

        if ($result['success']) {
            $this->clear_image_caches($image_id);
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    public function get_backup_status_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $image_ids = array_map('intval', $_POST['image_ids'] ?? array());
        $backup_status = array();

        foreach ($image_ids as $image_id) {
            $image_path = get_attached_file($image_id);
            $backup_path = $image_path . '.backup';

            $backup_status[$image_id] = array(
                'has_backup' => file_exists($backup_path),
                'backup_size' => file_exists($backup_path) ? filesize($backup_path) : 0,
                'backup_date' => file_exists($backup_path) ? date('Y-m-d H:i:s', filemtime($backup_path)) : null
            );
        }

        wp_send_json_success($backup_status);
    }

    public function admin_page()
    {
?>
        <div class="wrap">
            <h1>🚀 Bulk Image Cropper v1.1 - Preview & Commit System</h1>
            <p>Crop preview mode: Test different padding values before committing changes</p>

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
                                <input type="text" id="search-products" placeholder="Pretraži proizvode po nazivu..." style="width: 250px; padding: 6px 8px;">
                                <button id="clear-search" class="button button-secondary" style="display: none;">✕</button>
                            </div>

                            <button id="reset-plugin" class="button button-secondary">🔄 Resetuj Sve</button>
                            <span class="loading" id="category-loading" style="display: none;">Učitavanje...</span>
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
                            <h3>📊 Poslednji Rezultati</h3>
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
                            <h2>🎯 Glavne Slike za Kropovanje</h2>
                            <p><em>Preview mode: Test → Preview → Save (individual padding control per image)</em></p>

                            <div class="crop-controls">
                                <div class="selection-controls">
                                    <button id="select-all-images" class="button-small">Sve</button>
                                    <button id="deselect-all-images" class="button-small">Nijedna</button>
                                    <span id="selected-count">0 selected</span>
                                </div>

                                <button id="crop-selected" class="button button-primary" disabled>🚀 Bulk Crop (5px)</button>
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
                    <button id="toggle-detailed-log" class="button button-small">Prikaži/Sakrij Log</button>
                </div>

                <div class="section" id="cropped-images-section" style="display: none;">
                    <h2>🖼️ Rezultati Kropovanih Slika</h2>
                    <div id="cropped-images-grid"></div>
                </div>

            </div>
        </div>
<?php
    }

    public function reset_plugin_state_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');
        wp_send_json_success(array('message' => 'Plugin state reset'));
    }

    public function get_product_categories_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');
        set_time_limit(0);

        $categories = get_terms(array(
            'taxonomy' => 'product_cat',
            'hide_empty' => true,
            'orderby' => 'name',
            'order' => 'ASC',
            'number' => 200
        ));

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

        if (count($product_ids) > 20) {
            $product_ids = array_slice($product_ids, 0, 20);
        }

        $all_images = array();

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
                }
            }
        }

        wp_send_json_success(array(
            'images' => $all_images,
            'total_images' => count($all_images),
            'products_count' => count($product_ids)
        ));
    }

    public function crop_single_image_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        set_time_limit(60);
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit();
        }

        $image_id = intval($_POST['image_id']);
        $result = $this->crop_image_by_id($image_id);

        if ($result['success']) {
            $this->clear_image_caches($image_id);
        }

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    public function crop_selected_images_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        set_time_limit(0);
        if (function_exists('wp_raise_memory_limit')) {
            wp_raise_memory_limit();
        }

        $image_ids = array_map('intval', $_POST['image_ids']);

        if (count($image_ids) > 50) {
            wp_send_json_error('Too many images selected. Please select maximum 50 images at once.');
        }

        $results = array();
        $success_count = 0;
        $error_count = 0;

        foreach ($image_ids as $image_id) {
            $result = $this->crop_image_by_id($image_id);
            $results[] = $result;

            if ($result['success']) {
                $success_count++;
                $this->clear_image_caches($image_id);
            } else {
                $error_count++;
            }
        }

        wp_send_json_success(array(
            'results' => $results,
            'summary' => array(
                'total' => count($image_ids),
                'success' => $success_count,
                'errors' => $error_count
            )
        ));
    }

    // KREIRAJ PREVIEW (ne diramo original!)
    private function create_preview_crop($image_id, $padding = 10)
    {
        $image_path = get_attached_file($image_id);

        if (!$image_path || !file_exists($image_path)) {
            return array(
                'success' => false,
                'message' => 'Image file not found'
            );
        }

        $backup_path = $image_path . '.backup';
        if (!file_exists($backup_path)) {
            copy($image_path, $backup_path);
        }

        $upload_dir = wp_upload_dir();
        $preview_dir = $upload_dir['basedir'] . '/crop-previews';
        if (!file_exists($preview_dir)) {
            wp_mkdir_p($preview_dir);
        }

        $preview_path = $preview_dir . '/preview_' . $image_id . '_' . $padding . 'px.jpg';

        $python_path = $this->get_python_path();
        $script_path = plugin_dir_path(__FILE__) . 'cropper.py';

        $command = escapeshellcmd($python_path . ' ' . $script_path . ' ' .
            escapeshellarg($image_path) . ' ' .
            escapeshellarg($preview_path) . ' ' .
            intval($padding));

        exec($command . ' 2>&1', $output, $return_var);
        $log_output = implode("\n", $output);

        if ($return_var === 0 && file_exists($preview_path)) {
            $preview_url = $upload_dir['baseurl'] . '/crop-previews/' . basename($preview_path) . '?v=' . time();
            $preview_size = getimagesize($preview_path);
            $preview_dimensions = $preview_size ? $preview_size[0] . 'x' . $preview_size[1] : 'Unknown';

            return array(
                'success' => true,
                'image_id' => $image_id,
                'message' => "Preview created with {$padding}px padding",
                'preview_url' => $preview_url,
                'preview_path' => $preview_path,
                'preview_size' => $preview_dimensions,
                'padding_used' => $padding,
                'log' => $log_output,
                'has_backup' => file_exists($backup_path)
            );
        } else {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Preview creation failed: ' . $log_output,
                'return_code' => $return_var
            );
        }
    }

    // COMMIT PREVIEW TO ORIGINAL
    private function commit_preview_to_original($image_id)
    {
        $image_path = get_attached_file($image_id);
        $upload_dir = wp_upload_dir();
        $preview_dir = $upload_dir['basedir'] . '/crop-previews';

        $preview_files = glob($preview_dir . '/preview_' . $image_id . '_*.jpg');

        if (empty($preview_files)) {
            return array(
                'success' => false,
                'message' => 'No preview found to commit'
            );
        }

        $latest_preview = array_reduce($preview_files, function ($latest, $current) {
            return (filemtime($current) > filemtime($latest)) ? $current : $latest;
        }, $preview_files[0]);

        if (copy($latest_preview, $image_path)) {
            $this->regenerate_image_sizes($image_id);
            $image_meta = wp_get_attachment_metadata($image_id);

            foreach ($preview_files as $preview_file) {
                unlink($preview_file);
            }

            return array(
                'success' => true,
                'image_id' => $image_id,
                'message' => 'Preview committed successfully',
                'new_size' => isset($image_meta['width']) ? $image_meta['width'] . 'x' . $image_meta['height'] : 'Unknown',
                'committed_url' => wp_get_attachment_image_url($image_id, 'full') . '?v=' . time()
            );
        } else {
            return array(
                'success' => false,
                'message' => 'Failed to commit preview'
            );
        }
    }

    // DISCARD PREVIEW
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

    private function crop_image_by_id($image_id, $padding = 5)
    {
        $image_path = get_attached_file($image_id);

        if (!$image_path || !file_exists($image_path)) {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Image file not found'
            );
        }

        $python_path = $this->get_python_path();
        $script_path = plugin_dir_path(__FILE__) . 'cropper.py';

        if (!file_exists($script_path)) {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Python script not found'
            );
        }

        $backup_path = $image_path . '.backup';
        if (!file_exists($backup_path)) {
            copy($image_path, $backup_path);
        }

        $temp_cropped = $image_path . '.temp_cropped.png';

        $command = escapeshellcmd($python_path . ' ' . $script_path . ' ' .
            escapeshellarg($image_path) . ' ' .
            escapeshellarg($temp_cropped) . ' ' .
            intval($padding));

        exec($command . ' 2>&1', $output, $return_var);
        $log_output = implode("\n", $output);

        if ($return_var === 0 && file_exists($temp_cropped)) {
            if (copy($temp_cropped, $image_path)) {
                unlink($temp_cropped);
                $this->regenerate_image_sizes($image_id);
                $image_meta = wp_get_attachment_metadata($image_id);

                return array(
                    'success' => true,
                    'image_id' => $image_id,
                    'message' => "Image cropped successfully with {$padding}px padding",
                    'padding_used' => $padding,
                    'new_size' => isset($image_meta['width']) ? $image_meta['width'] . 'x' . $image_meta['height'] : 'Unknown',
                    'log' => $log_output,
                    'cropped_url' => wp_get_attachment_image_url($image_id, 'full') . '?v=' . time(),
                    'has_backup' => file_exists($backup_path)
                );
            } else {
                return array(
                    'success' => false,
                    'image_id' => $image_id,
                    'message' => 'Failed to replace original image'
                );
            }
        } else {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Python script failed: ' . $log_output,
                'return_code' => $return_var
            );
        }
    }

    private function restore_from_backup($image_id)
    {
        $image_path = get_attached_file($image_id);
        $backup_path = $image_path . '.backup';

        if (!file_exists($backup_path)) {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'No backup found for this image'
            );
        }

        if (!file_exists($image_path)) {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Original image file not found'
            );
        }

        if (copy($backup_path, $image_path)) {
            $this->regenerate_image_sizes($image_id);
            $image_meta = wp_get_attachment_metadata($image_id);

            return array(
                'success' => true,
                'image_id' => $image_id,
                'message' => 'Image restored from backup successfully',
                'restored_size' => isset($image_meta['width']) ? $image_meta['width'] . 'x' . $image_meta['height'] : 'Unknown',
                'restored_url' => wp_get_attachment_image_url($image_id, 'full') . '?v=' . time()
            );
        } else {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Failed to restore from backup'
            );
        }
    }

    private function clear_image_caches($image_id)
    {
        wp_cache_delete($image_id, 'posts');
        clean_attachment_cache($image_id);

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

    private function get_python_path()
    {
        $paths = array('python3', 'python', '/usr/bin/python3', '/usr/bin/python');

        foreach ($paths as $path) {
            $test_command = $path . ' --version 2>&1';
            exec($test_command, $output, $return_var);
            if ($return_var === 0) {
                return $path;
            }
        }

        return 'python';
    }
}

new BulkImageCropper();
